import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  DispatchPriority,
  DisruptionConfig,
  RecoveryAction,
  SimulationResult,
} from '../types/network';

export interface SavedScenarioRecord {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  airportCode: string;
  startMin: number;
  endMin: number;
  reason: DisruptionConfig['reason'];
  priority: DispatchPriority;
  actionIds: string[];
  actionLabels: string[];
  baselineStranded: number;
  afterStranded: number;
  baselineDelayMin: number;
  afterDelayMin: number;
  baselineCancelled: number;
  afterCancelled: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type LogCategory = 'INCIDENT' | 'RECOVERY' | 'CREW_FDTL' | 'HANDOVER';
export type LogSeverity = 'ROUTINE' | 'ADVISORY' | 'CRITICAL';

export interface ShiftLogEntryRecord {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  category: LogCategory;
  severity: LogSeverity;
  status: 'open' | 'resolved';
  scenarioRef: string;
  resolvedNote: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const GUEST_SCENARIOS_KEY = 'domino-sky-guest-scenarios-v1';
const GUEST_LOGBOOK_KEY = 'domino-sky-guest-logbook-v1';

const VALID_REASONS: DisruptionConfig['reason'][] = [
  'Thunderstorm',
  'Dense Fog',
  'Runway Closure',
  'ATC Ground Stop',
];

const VALID_PRIORITIES: DispatchPriority[] = [
  'BALANCED',
  'MINIMIZE_STRANDED',
  'ZERO_CANCELLATIONS',
  'MINIMIZE_DELAY',
  'LOW_RESOURCE',
];

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'seconds' in val && typeof (val as { seconds: number }).seconds === 'number') {
    return (val as { seconds: number }).seconds * 1000;
  }
  if (typeof val === 'number') return val;
  return Date.now();
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 8) || 'x1';
  return `${prefix}-${Date.now()}-${rand}`;
}

function clampInt(val: number, min: number, max: number): number {
  const n = Math.round(Number.isFinite(val) ? val : min);
  return Math.max(min, Math.min(max, n));
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage error
  }
}

interface UseCloudWorkspaceArgs {
  watchlistIds: string[];
  dispatchPriority: DispatchPriority;
  onHydratePreferences: (prefs: { watchlistIds: string[]; defaultPriority: DispatchPriority }) => void;
}

export function useCloudWorkspace({
  watchlistIds,
  dispatchPriority,
  onHydratePreferences,
}: UseCloudWorkspaceArgs) {
  const { user, authReady, profileReady } = useAuth();
  const isCloudActive = Boolean(authReady && profileReady && user);

  const [scenarios, setScenarios] = useState<SavedScenarioRecord[]>(() =>
    readLocalJson<SavedScenarioRecord[]>(GUEST_SCENARIOS_KEY, [])
  );
  const [logEntries, setLogEntries] = useState<ShiftLogEntryRecord[]>(() =>
    readLocalJson<ShiftLogEntryRecord[]>(GUEST_LOGBOOK_KEY, [])
  );
  const [cloudHydrated, setCloudHydrated] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const hydrateCallbackRef = useRef(onHydratePreferences);
  hydrateCallbackRef.current = onHydratePreferences;

  const lastSyncedPrefsRef = useRef<string>('');

  // Persist guest mode data locally whenever not signed in
  useEffect(() => {
    if (!user && authReady) {
      writeLocalJson(GUEST_SCENARIOS_KEY, scenarios);
    }
  }, [scenarios, user, authReady]);

  useEffect(() => {
    if (!user && authReady) {
      writeLocalJson(GUEST_LOGBOOK_KEY, logEntries);
    }
  }, [logEntries, user, authReady]);

  // Attach Firestore real-time listeners strictly after authReady && profileReady && user
  useEffect(() => {
    if (!isCloudActive || !user) {
      setCloudHydrated(false);
      lastSyncedPrefsRef.current = '';
      if (authReady && !user) {
        setScenarios(readLocalJson<SavedScenarioRecord[]>(GUEST_SCENARIOS_KEY, []));
        setLogEntries(readLocalJson<ShiftLogEntryRecord[]>(GUEST_LOGBOOK_KEY, []));
      }
      return;
    }

    const uid = user.uid;
    const prefPath = `users/${uid}/preferences/workspace`;
    const scenariosPath = `users/${uid}/scenarios`;
    const logbookPath = `users/${uid}/logbook`;

    // 1. Preferences listener
    const prefRef = doc(db, 'users', uid, 'preferences', 'workspace');
    const unsubPrefs = onSnapshot(
      prefRef,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const remoteWatchlist = Array.isArray(d.watchlistIds)
            ? d.watchlistIds.filter((x): x is string => typeof x === 'string').slice(0, 70)
            : [];
          const remotePriority: DispatchPriority = VALID_PRIORITIES.includes(d.defaultPriority)
            ? d.defaultPriority
            : 'BALANCED';
          lastSyncedPrefsRef.current = JSON.stringify({
            watchlistIds: remoteWatchlist,
            defaultPriority: remotePriority,
          });
          hydrateCallbackRef.current({
            watchlistIds: remoteWatchlist,
            defaultPriority: remotePriority,
          });
        }
        setCloudHydrated(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, prefPath);
      }
    );

    // 2. Saved Scenarios listener (ownerId filter required by security rules)
    const scenariosQ = query(collection(db, 'users', uid, 'scenarios'), where('ownerId', '==', uid));
    const unsubScenarios = onSnapshot(
      scenariosQ,
      (snap) => {
        const list: SavedScenarioRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              ownerId: String(d.ownerId ?? uid),
              title: String(d.title ?? 'Untitled Scenario'),
              notes: String(d.notes ?? ''),
              airportCode: String(d.airportCode ?? 'BOM'),
              startMin: Number(d.startMin ?? 480),
              endMin: Number(d.endMin ?? 570),
              reason: VALID_REASONS.includes(d.reason) ? d.reason : 'Thunderstorm',
              priority: VALID_PRIORITIES.includes(d.priority) ? d.priority : 'BALANCED',
              actionIds: Array.isArray(d.actionIds)
                ? d.actionIds.filter((x): x is string => typeof x === 'string')
                : [],
              actionLabels: Array.isArray(d.actionLabels)
                ? d.actionLabels.filter((x): x is string => typeof x === 'string')
                : [],
              baselineStranded: Number(d.baselineStranded ?? 0),
              afterStranded: Number(d.afterStranded ?? 0),
              baselineDelayMin: Number(d.baselineDelayMin ?? 0),
              afterDelayMin: Number(d.afterDelayMin ?? 0),
              baselineCancelled: Number(d.baselineCancelled ?? 0),
              afterCancelled: Number(d.afterCancelled ?? 0),
              createdAtMs: timestampToMs(d.createdAt),
              updatedAtMs: timestampToMs(d.updatedAt),
            };
          })
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        setScenarios(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, scenariosPath);
      }
    );

    // 3. Shift Logbook listener (ownerId filter required by security rules)
    const logbookQ = query(collection(db, 'users', uid, 'logbook'), where('ownerId', '==', uid));
    const unsubLogbook = onSnapshot(
      logbookQ,
      (snap) => {
        const list: ShiftLogEntryRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              ownerId: String(d.ownerId ?? uid),
              title: String(d.title ?? ''),
              notes: String(d.notes ?? ''),
              category: (['INCIDENT', 'RECOVERY', 'CREW_FDTL', 'HANDOVER'].includes(d.category)
                ? d.category
                : 'INCIDENT') as LogCategory,
              severity: (['ROUTINE', 'ADVISORY', 'CRITICAL'].includes(d.severity)
                ? d.severity
                : 'ADVISORY') as LogSeverity,
              status: (d.status === 'resolved' ? 'resolved' : 'open') as 'open' | 'resolved',
              scenarioRef: String(d.scenarioRef ?? ''),
              resolvedNote: String(d.resolvedNote ?? ''),
              createdAtMs: timestampToMs(d.createdAt),
              updatedAtMs: timestampToMs(d.updatedAt),
            };
          })
          .sort((a, b) => b.createdAtMs - a.createdAtMs);
        setLogEntries(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, logbookPath);
      }
    );

    return () => {
      unsubPrefs();
      unsubScenarios();
      unsubLogbook();
    };
  }, [isCloudActive, user, authReady]);

  // Sync Watchlist & Default Priority back to Firestore whenever changed locally
  useEffect(() => {
    if (!isCloudActive || !user || !cloudHydrated) return;

    const cleanWatchlist = watchlistIds
      .map((id) => id.trim().slice(0, 120))
      .filter((id) => id.length > 0)
      .slice(0, 70);
    const cleanPriority: DispatchPriority = VALID_PRIORITIES.includes(dispatchPriority)
      ? dispatchPriority
      : 'BALANCED';

    const payloadKey = JSON.stringify({
      watchlistIds: cleanWatchlist,
      defaultPriority: cleanPriority,
    });
    if (payloadKey === lastSyncedPrefsRef.current) return;

    const timer = window.setTimeout(async () => {
      const uid = user.uid;
      const prefPath = `users/${uid}/preferences/workspace`;
      const prefRef = doc(db, 'users', uid, 'preferences', 'workspace');
      try {
        const snap = await getDoc(prefRef);
        if (snap.exists()) {
          await updateDoc(prefRef, {
            watchlistIds: cleanWatchlist,
            defaultPriority: cleanPriority,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(prefRef, {
            ownerId: uid,
            watchlistIds: cleanWatchlist,
            defaultPriority: cleanPriority,
            updatedAt: serverTimestamp(),
          });
        }
        lastSyncedPrefsRef.current = payloadKey;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, prefPath);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [isCloudActive, user, cloudHydrated, watchlistIds, dispatchPriority]);

  const saveScenario = useCallback(
    async (args: {
      title: string;
      notes: string;
      disruption: DisruptionConfig;
      priority: DispatchPriority;
      actions: RecoveryAction[];
      baseline: SimulationResult;
      result: SimulationResult;
    }) => {
      const cleanTitle = args.title.trim().slice(0, 100);
      if (!cleanTitle) return;
      const cleanNotes = args.notes.trim().slice(0, 500);
      const airportCode = args.disruption.airportCode.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'BOM';
      const startMin = clampInt(args.disruption.startMin, 300, 1200);
      const endMin = clampInt(Math.max(startMin + 30, args.disruption.endMin), startMin + 1, 1380);
      const reason = VALID_REASONS.includes(args.disruption.reason) ? args.disruption.reason : 'Thunderstorm';
      const priority = VALID_PRIORITIES.includes(args.priority) ? args.priority : 'BALANCED';
      const actionIds = args.actions
        .map((a) => a.id.trim().slice(0, 120))
        .filter((s) => s.length > 0)
        .slice(0, 15);
      const actionLabels = args.actions
        .map((a) => a.label.trim().slice(0, 120))
        .filter((s) => s.length > 0)
        .slice(0, 15);

      const baselineStranded = clampInt(args.baseline.summary.strandedPassengers, 0, 50000);
      const afterStranded = clampInt(args.result.summary.strandedPassengers, 0, 50000);
      const baselineDelayMin = clampInt(args.baseline.summary.totalDelayMinutes, 0, 200000);
      const afterDelayMin = clampInt(args.result.summary.totalDelayMinutes, 0, 200000);
      const baselineCancelled = clampInt(args.baseline.summary.cancelledFlights, 0, 500);
      const afterCancelled = clampInt(args.result.summary.cancelledFlights, 0, 500);

      const scenarioId = makeDocId('sc');

      if (!isCloudActive || !user) {
        const now = Date.now();
        const localRec: SavedScenarioRecord = {
          id: scenarioId,
          ownerId: 'guest',
          title: cleanTitle,
          notes: cleanNotes,
          airportCode,
          startMin,
          endMin,
          reason,
          priority,
          actionIds,
          actionLabels,
          baselineStranded,
          afterStranded,
          baselineDelayMin,
          afterDelayMin,
          baselineCancelled,
          afterCancelled,
          createdAtMs: now,
          updatedAtMs: now,
        };
        setScenarios((prev) => [localRec, ...prev]);
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/scenarios/${scenarioId}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'scenarios', scenarioId), {
          ownerId: user.uid,
          title: cleanTitle,
          notes: cleanNotes,
          airportCode,
          startMin,
          endMin,
          reason,
          priority,
          actionIds,
          actionLabels,
          baselineStranded,
          afterStranded,
          baselineDelayMin,
          afterDelayMin,
          baselineCancelled,
          afterCancelled,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  const updateScenarioDetails = useCallback(
    async (scenarioId: string, title: string, notes: string) => {
      const cleanTitle = title.trim().slice(0, 100);
      if (!cleanTitle) return;
      const cleanNotes = notes.trim().slice(0, 500);

      if (!isCloudActive || !user) {
        setScenarios((prev) =>
          prev.map((s) =>
            s.id === scenarioId ? { ...s, title: cleanTitle, notes: cleanNotes, updatedAtMs: Date.now() } : s
          )
        );
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/scenarios/${scenarioId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'scenarios', scenarioId), {
          title: cleanTitle,
          notes: cleanNotes,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  const deleteScenario = useCallback(
    async (scenarioId: string) => {
      if (!isCloudActive || !user) {
        setScenarios((prev) => prev.filter((s) => s.id !== scenarioId));
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/scenarios/${scenarioId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'scenarios', scenarioId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  const addLogEntry = useCallback(
    async (args: {
      title: string;
      notes: string;
      category: LogCategory;
      severity: LogSeverity;
      scenarioRef: string;
    }) => {
      const cleanTitle = args.title.trim().slice(0, 120);
      const cleanNotes = args.notes.trim().slice(0, 1000);
      if (!cleanTitle || !cleanNotes) return;
      const cleanRef = args.scenarioRef.trim().slice(0, 160);
      const entryId = makeDocId('log');

      if (!isCloudActive || !user) {
        const now = Date.now();
        const localRec: ShiftLogEntryRecord = {
          id: entryId,
          ownerId: 'guest',
          title: cleanTitle,
          notes: cleanNotes,
          category: args.category,
          severity: args.severity,
          status: 'open',
          scenarioRef: cleanRef,
          resolvedNote: '',
          createdAtMs: now,
          updatedAtMs: now,
        };
        setLogEntries((prev) => [localRec, ...prev]);
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/logbook/${entryId}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'logbook', entryId), {
          ownerId: user.uid,
          title: cleanTitle,
          notes: cleanNotes,
          category: args.category,
          severity: args.severity,
          status: 'open',
          scenarioRef: cleanRef,
          resolvedNote: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  const resolveLogEntry = useCallback(
    async (entryId: string, resolvedNote: string) => {
      const cleanResolution = resolvedNote.trim().slice(0, 400);

      if (!isCloudActive || !user) {
        setLogEntries((prev) =>
          prev.map((e) =>
            e.id === entryId && e.status === 'open'
              ? { ...e, status: 'resolved', resolvedNote: cleanResolution, updatedAtMs: Date.now() }
              : e
          )
        );
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/logbook/${entryId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'logbook', entryId), {
          status: 'resolved',
          resolvedNote: cleanResolution,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  const deleteLogEntry = useCallback(
    async (entryId: string) => {
      if (!isCloudActive || !user) {
        setLogEntries((prev) => prev.filter((e) => e.id !== entryId));
        return;
      }

      setSyncBusy(true);
      const path = `users/${user.uid}/logbook/${entryId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'logbook', entryId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      } finally {
        setSyncBusy(false);
      }
    },
    [isCloudActive, user]
  );

  return {
    isCloudActive,
    syncBusy,
    scenarios,
    logEntries,
    saveScenario,
    updateScenarioDetails,
    deleteScenario,
    addLogEntry,
    resolveLogEntry,
    deleteLogEntry,
  };
}
