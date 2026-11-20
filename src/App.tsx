import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  RotateCcw,
  Wand2,
  Loader2,
  Star,
  AlertTriangle,
  BookmarkPlus,
  Download,
  LogIn,
  LogOut,
  Cloud,
  Check,
  Plus,
  X,
  Upload,
  FileText,
} from 'lucide-react';
import { DEFAULT_DATASET, PRESET_SCENARIOS } from './data/networkDataset';
import { evaluateCandidateRecoveryPlans, generateAvailableActions } from './engine/optimizer';
import { simulateNetwork } from './engine/simulator';
import {
  AICommsResponse,
  AIDispatcherResponse,
  DispatchPriority,
  DisruptionConfig,
  NetworkDataset,
  ParsedScenarioResponse,
  RecoveryAction,
  SimulatedFlight,
} from './types/network';
import { formatDelta, formatDuration, formatTime, parseTime } from './utils/time';
import { COST_WEIGHTS_INR, formatInrCompact, formatInrDelta } from './utils/costEstimator';
import { exportExecutiveBriefingMarkdown, exportFlightManifestCsv } from './utils/exportReports';
import { IndiaAirspaceMap } from './components/IndiaAirspaceMap';
import { CascadeInspector } from './components/CascadeInspector';
import { FleetTimelineView } from './components/FleetTimelineView';
import { FlightLedgerView } from './components/FlightLedgerView';
import { AIDispatcherPanel } from './components/AIDispatcherPanel';
import { WatchlistToast, WatchlistToastEvent } from './components/WatchlistToast';
import { LoginPortal } from './components/LoginPortal';
import { OpsHubView } from './components/OpsHubView';
import { DatasetUploaderModal } from './components/DatasetUploaderModal';
import { RegionalDelayRadar } from './components/RegionalDelayRadar';
import { useAuth } from './context/AuthContext';
import { SavedScenarioRecord, useCloudWorkspace } from './hooks/useCloudWorkspace';

const SKY_BACKDROP_SRC = '/src/assets/images/domino_sky_panorama_1795152823592.jpg';

type ActiveView = 'map' | 'timeline' | 'ledger' | 'dispatcher' | 'ops';
type MapSideTab = 'cascade' | 'recovery';

const START_TIME_OPTIONS = Array.from({ length: 27 }, (_, i) => 330 + i * 30); // 05:30 to 18:30
const DURATION_OPTIONS = [60, 90, 120, 180];
const REASON_OPTIONS: DisruptionConfig['reason'][] = [
  'Thunderstorm',
  'Dense Fog',
  'Runway Closure',
  'ATC Ground Stop',
];

export default function App() {
  const { user, profile, authReady, showLoginPortal, openLoginPortal, signOutUser } = useAuth();
  const [quickSaveDone, setQuickSaveDone] = useState(false);

  const [dataset, setDataset] = useState<NetworkDataset>(DEFAULT_DATASET);
  const [isCustomDataset, setIsCustomDataset] = useState(false);
  const [showDatasetModal, setShowDatasetModal] = useState(false);

  // Start on the headline scenario: Mumbai 90-minute thunderstorm (08:00–09:30)
  const [disruption, setDisruption] = useState<DisruptionConfig | null>(
    PRESET_SCENARIOS[0].disruption
  );
  const [secondaryDisruption, setSecondaryDisruption] = useState<DisruptionConfig | null>(null);
  const [activeActions, setActiveActions] = useState<RecoveryAction[]>([]);

  // Navigation & Selection State
  const [activeView, setActiveView] = useState<ActiveView>('map');
  const [mapSideTab, setMapSideTab] = useState<MapSideTab>('cascade');
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>('DS-105');
  const [selectedAirportCode, setSelectedAirportCode] = useState<string | null>(null);

  // Time-of-Day Playback State (05:00 to 24:00, 1x / 5x / 15x speeds)
  const [currentTimeMin, setCurrentTimeMin] = useState<number>(parseTime('15:30'));
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 5 | 15>(5);

  // AI Dispatcher State
  const [dispatchPriority, setDispatchPriority] = useState<DispatchPriority>('BALANCED');
  const [aiResponse, setAiResponse] = useState<AIDispatcherResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Natural-Language AI Scenario Composer State
  const [scenarioPrompt, setScenarioPrompt] = useState<string>('');
  const [scenarioLoading, setScenarioLoading] = useState<boolean>(false);
  const [scenarioNote, setScenarioNote] = useState<string | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  // Watchlist State (persisted to localStorage)
  const [watchlistIds, setWatchlistIds] = useState<string[]>(() => {
    try {
      const saved = window.localStorage.getItem('domino-sky-watchlist');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // ignore storage failure
    }
    return [];
  });
  const [watchlistToast, setWatchlistToast] = useState<WatchlistToastEvent | null>(null);
  const [watchlistFocusSignal, setWatchlistFocusSignal] = useState<number>(0);
  const prevWatchedStateRef = useRef<Map<string, { status: SimulatedFlight['status']; delay: number }>>(new Map());

  // Deterministic Simulation (Baseline without recovery, and Current with active recovery actions)
  const baseline = useMemo(
    () => simulateNetwork(dataset, disruption, [], secondaryDisruption),
    [dataset, disruption, secondaryDisruption]
  );

  const result = useMemo(
    () =>
      activeActions.length === 0
        ? baseline
        : simulateNetwork(dataset, disruption, activeActions, secondaryDisruption),
    [dataset, disruption, secondaryDisruption, activeActions, baseline]
  );

  const availableActions = useMemo(
    () => generateAvailableActions(dataset, disruption, baseline, secondaryDisruption),
    [dataset, disruption, baseline, secondaryDisruption]
  );

  const candidatePlans = useMemo(
    () => evaluateCandidateRecoveryPlans(dataset, disruption, baseline, secondaryDisruption),
    [dataset, disruption, baseline, secondaryDisruption]
  );

  // Cloud-synced Workspace (Playbooks, Shift Logbook, Watchlist & Default Priority)
  const handleHydratePreferences = useCallback(
    (prefs: { watchlistIds: string[]; defaultPriority: DispatchPriority }) => {
      setWatchlistIds(prefs.watchlistIds);
      setDispatchPriority(prefs.defaultPriority);
    },
    []
  );

  const cloudWorkspace = useCloudWorkspace({
    watchlistIds,
    dispatchPriority,
    onHydratePreferences: handleHydratePreferences,
  });

  // Persist Watchlist to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem('domino-sky-watchlist', JSON.stringify(watchlistIds));
    } catch {
      // ignore storage failure
    }
  }, [watchlistIds]);

  const affectedWatchedFlights = useMemo(() => {
    const idSet = new Set(watchlistIds);
    return result.flights.filter(
      (sf) => idSet.has(sf.flight.id) && (sf.status === 'DELAYED' || sf.status === 'CANCELLED')
    );
  }, [result.flights, watchlistIds]);

  // Detect whenever starred flights become delayed, cancelled, or recovered in the live simulation
  useEffect(() => {
    const prevMap = prevWatchedStateRef.current;
    const nextMap = new Map<string, { status: SimulatedFlight['status']; delay: number }>();

    const newlyCancelled: SimulatedFlight[] = [];
    const newlyDelayed: SimulatedFlight[] = [];
    const newlyRecovered: SimulatedFlight[] = [];

    for (const id of watchlistIds) {
      const sf = result.flightsById[id];
      if (!sf) continue;
      nextMap.set(id, { status: sf.status, delay: sf.arrDelayMin });

      const prev = prevMap.get(id);
      if (!prev) {
        // Flight was just added to Watchlist: alert immediately if it is currently disrupted
        if (sf.status === 'CANCELLED') newlyCancelled.push(sf);
        else if (sf.status === 'DELAYED') newlyDelayed.push(sf);
      } else {
        if (sf.status === 'CANCELLED' && prev.status !== 'CANCELLED') {
          newlyCancelled.push(sf);
        } else if (
          sf.status === 'DELAYED' &&
          (prev.status === 'ON_TIME' || sf.arrDelayMin > prev.delay + 10)
        ) {
          newlyDelayed.push(sf);
        } else if (sf.status === 'ON_TIME' && prev.status !== 'ON_TIME') {
          newlyRecovered.push(sf);
        }
      }
    }

    prevWatchedStateRef.current = nextMap;

    if (newlyCancelled.length > 0 || newlyDelayed.length > 0) {
      const combined = [...newlyCancelled, ...newlyDelayed];
      setWatchlistToast({
        id: `${Date.now()}`,
        tone: newlyCancelled.length > 0 ? 'cancelled' : 'delayed',
        title:
          newlyCancelled.length > 0
            ? `Watchlist Cancellation Alert`
            : `Watchlist Delay Alert`,
        flights: combined,
      });
    } else if (newlyRecovered.length > 0) {
      setWatchlistToast({
        id: `${Date.now()}`,
        tone: 'recovered',
        title: `Watchlist Flight Recovered`,
        flights: newlyRecovered,
      });
    }
  }, [result, watchlistIds]);

  // Auto-dismiss Watchlist Toast after 9 seconds
  useEffect(() => {
    if (!watchlistToast) return;
    const timer = window.setTimeout(() => {
      setWatchlistToast(null);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [watchlistToast]);

  const handleToggleWatchlist = (flightId: string) => {
    setWatchlistIds((prev) =>
      prev.includes(flightId) ? prev.filter((id) => id !== flightId) : [...prev, flightId]
    );
  };

  const openWatchlistInLedger = () => {
    setActiveView('ledger');
    setWatchlistFocusSignal((n) => n + 1);
    setWatchlistToast(null);
  };

  // Playback loop (05:00 to 24:00 at 1x, 5x, or 15x speed)
  useEffect(() => {
    if (!isPlaying) return;
    const stepMin = playbackSpeed === 15 ? 10 : playbackSpeed === 5 ? 5 : 2;
    const intervalMs = playbackSpeed === 15 ? 110 : playbackSpeed === 5 ? 180 : 320;
    const timer = window.setInterval(() => {
      setCurrentTimeMin((prev) => {
        if (prev >= 1440) {
          setIsPlaying(false);
          return 1440;
        }
        return Math.min(1440, prev + stepMin);
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackSpeed]);

  const updateDisruption = (
    next: DisruptionConfig | null,
    focusClock?: number,
    nextSecondary?: DisruptionConfig | null
  ) => {
    setDisruption(next);
    if (next === null) {
      setSecondaryDisruption(null);
    } else if (nextSecondary !== undefined) {
      setSecondaryDisruption(nextSecondary);
    }
    setActiveActions([]);
    setAiResponse(null);
    setAiError(null);
    setSelectedAirportCode(null);
    setSelectedFlightId(null);
    setIsPlaying(false);
    if (focusClock !== undefined) {
      setCurrentTimeMin(focusClock);
    } else if (next) {
      const latestEnd = Math.max(next.endMin, nextSecondary?.endMin ?? 0);
      setCurrentTimeMin(Math.min(1320, latestEnd + 300));
    } else {
      setCurrentTimeMin(parseTime('11:00'));
    }
  };

  const handleCloseAirportFromMap = (code: string) => {
    const startMin = disruption?.startMin ?? parseTime('08:00');
    const duration = disruption ? disruption.endMin - disruption.startMin : 90;
    updateDisruption(
      {
        airportCode: code,
        startMin,
        endMin: startMin + duration,
        reason: disruption?.reason ?? 'Thunderstorm',
      },
      undefined,
      null
    );
  };

  const handleAddSecondaryDisruption = () => {
    if (!disruption) return;
    const fallbackAirport =
      dataset.airports.find((a) => a.code !== disruption.airportCode && ['DEL', 'BOM', 'BLR', 'HYD'].includes(a.code))
        ?.code ??
      dataset.airports.find((a) => a.code !== disruption.airportCode)?.code ??
      disruption.airportCode;
    const secStart = Math.min(parseTime('18:00'), Math.max(parseTime('14:00'), disruption.endMin + 120));
    setSecondaryDisruption({
      airportCode: fallbackAirport,
      startMin: secStart,
      endMin: secStart + 90,
      reason: fallbackAirport === 'DEL' ? 'Dense Fog' : 'ATC Ground Stop',
    });
    setActiveActions([]);
    setAiResponse(null);
    setAiError(null);
  };

  const handleUpdateSecondaryDisruption = (nextSec: DisruptionConfig | null) => {
    setSecondaryDisruption(nextSec);
    setActiveActions([]);
    setAiResponse(null);
    setAiError(null);
  };

  const handleToggleAction = (action: RecoveryAction) => {
    setActiveActions((prev) => {
      const exists = prev.some((a) => a.id === action.id);
      if (exists) {
        return prev.filter((a) => a.id !== action.id);
      }
      // Replace conflicting spare, standby crew, or same-flight action cleanly
      const filtered = prev.filter((a) => {
        if (a.flightId === action.flightId) return false;
        if (action.spareId && a.spareId === action.spareId) return false;
        if (action.standbyCrewId && a.standbyCrewId === action.standbyCrewId) return false;
        return true;
      });
      return [...filtered, action];
    });
  };

  const requestAIRecommendations = async (overridePriority?: DispatchPriority) => {
    if (!disruption || candidatePlans.length === 0 || aiLoading) return;
    const targetPriority = overridePriority ?? dispatchPriority;
    setAiLoading(true);
    setAiError(null);

    try {
      const keyAffectedFlights = baseline.flights
        .filter((f) => f.status === 'CANCELLED' || f.arrDelayMin >= 30 || f.rootCause === 'CREW_CASCADE')
        .sort((a, b) => (b.status === 'CANCELLED' ? 1000 : b.arrDelayMin) - (a.status === 'CANCELLED' ? 1000 : a.arrDelayMin))
        .slice(0, 12)
        .map((f) => ({
          flightId: f.flight.id,
          route: `${f.flight.origin}->${f.flight.dest}`,
          aircraftId: f.flight.aircraftId,
          crewId: f.flight.crewId,
          status: f.status,
          arrDelayMin: f.arrDelayMin,
          rootCause: f.rootCause,
          causeSummary: f.causeSummary,
          passengers: f.flight.passengers,
          cancelledLocalPax: f.cancelledLocalPax,
          crewDutyAtArrivalMin: f.crewDutyAtArrivalMin,
          crewMaxDutyMin: f.crewMaxDutyMin,
        }));

      const brokenConnections = baseline.connections
        .filter((c) => c.status === 'MISSED_DELAY' || c.status === 'MISSED_CANCELLED')
        .map((c) => ({
          id: c.connection.id,
          airportCode: c.connection.airportCode,
          fromFlightId: c.connection.fromFlightId,
          toFlightId: c.connection.toFlightId,
          passengers: c.connection.passengers,
          status: c.status,
          shortfallMinutes: c.shortfallMinutes,
          strandedPassengers: c.strandedPassengers,
        }));

      const res = await fetch('/api/dispatcher/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priority: targetPriority,
          disruption: {
            ...disruption,
            startLabel: formatTime(disruption.startMin),
            endLabel: formatTime(disruption.endMin),
            durationMinutes: disruption.endMin - disruption.startMin,
          },
          secondaryDisruption: secondaryDisruption
            ? {
                ...secondaryDisruption,
                startLabel: formatTime(secondaryDisruption.startMin),
                endLabel: formatTime(secondaryDisruption.endMin),
                durationMinutes: secondaryDisruption.endMin - secondaryDisruption.startMin,
              }
            : null,
          costWeights: COST_WEIGHTS_INR,
          baselineSummary: baseline.summary,
          keyAffectedFlights,
          brokenConnections,
          candidatePlans,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }
      setAiResponse(data as AIDispatcherResponse);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to reach AI Dispatcher.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleParseScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = scenarioPrompt.trim();
    if (!trimmed || scenarioLoading) return;
    setScenarioLoading(true);
    setScenarioError(null);
    setScenarioNote(null);

    try {
      const res = await fetch('/api/dispatcher/parse-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          airports: dataset.airports.map((a) => ({ code: a.code, city: a.city })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not interpret scenario prompt.');
      }
      const parsed = data as ParsedScenarioResponse;
      setDispatchPriority(parsed.priority);
      updateDisruption(
        {
          airportCode: parsed.airportCode,
          startMin: parsed.startMin,
          endMin: parsed.endMin,
          reason: parsed.reason,
        },
        Math.min(1140, parsed.endMin + 300)
      );
      setScenarioNote(
        `${parsed.interpretation} (${parsed.airportCode} ${formatTime(parsed.startMin)}–${formatTime(parsed.endMin)} · ${parsed.reason})`
      );
      setScenarioPrompt('');
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : 'Failed to parse scenario.');
    } finally {
      setScenarioLoading(false);
    }
  };

  const handleGenerateComms = async (): Promise<AICommsResponse> => {
    const snapshot = {
      disruption: disruption
        ? {
            airportCode: disruption.airportCode,
            window: `${formatTime(disruption.startMin)}-${formatTime(disruption.endMin)}`,
            durationMinutes: disruption.endMin - disruption.startMin,
            reason: disruption.reason,
          }
        : null,
      secondaryDisruption: secondaryDisruption
        ? {
            airportCode: secondaryDisruption.airportCode,
            window: `${formatTime(secondaryDisruption.startMin)}-${formatTime(secondaryDisruption.endMin)}`,
            durationMinutes: secondaryDisruption.endMin - secondaryDisruption.startMin,
            reason: secondaryDisruption.reason,
          }
        : null,
      recoveryApplied: activeActions.length > 0,
      activeRecoveryActions: activeActions.map((a) => ({ label: a.label, detail: a.detail })),
      beforeSummary: baseline.summary,
      afterSummary: result.summary,
      cancelledFlights: result.flights
        .filter((f) => f.status === 'CANCELLED')
        .map((f) => ({
          flightId: f.flight.id,
          route: `${f.flight.origin}->${f.flight.dest}`,
          crewId: f.effectiveCrewId,
          passengers: f.flight.passengers,
          causeSummary: f.causeSummary,
        })),
      rescuedFlights: result.flights
        .filter((f) => f.isRecoveredByAction)
        .map((f) => ({
          flightId: f.flight.id,
          route: `${f.flight.origin}->${f.flight.dest}`,
          aircraftId: f.effectiveAircraftId,
          crewId: f.effectiveCrewId,
          actualDep: formatTime(f.actualDep),
          status: f.status,
          delayMinutes: f.arrDelayMin,
        })),
      crewBreaches: result.crews
        .filter((c) => c.breached)
        .map((c) => ({
          crewId: c.crew.id,
          name: c.crew.name,
          breachedFlightId: c.breachedFlightId,
          dutyMinutesUsed: c.dutyMinutesUsed,
          maxDutyMinutes: c.maxDutyMinutes,
        })),
    };

    const res = await fetch('/api/dispatcher/comms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Server error (${res.status})`);
    }
    return data as AICommsResponse;
  };

  const handleAskDispatcher = async (question: string): Promise<string> => {
    const context = {
      disruption: disruption
        ? {
            ...disruption,
            window: `${formatTime(disruption.startMin)}–${formatTime(disruption.endMin)}`,
            durationMinutes: disruption.endMin - disruption.startMin,
          }
        : null,
      secondaryDisruption: secondaryDisruption
        ? {
            ...secondaryDisruption,
            window: `${formatTime(secondaryDisruption.startMin)}–${formatTime(secondaryDisruption.endMin)}`,
            durationMinutes: secondaryDisruption.endMin - secondaryDisruption.startMin,
          }
        : null,
      costWeightsInr: COST_WEIGHTS_INR,
      baselineSummary: baseline.summary,
      currentSummary: result.summary,
      activeRecoveryActions: activeActions.map((a) => ({ label: a.label, detail: a.detail })),
      cancelledFlights: result.flights
        .filter((f) => f.status === 'CANCELLED')
        .map((f) => ({
          flightId: f.flight.id,
          route: `${f.flight.origin}->${f.flight.dest}`,
          aircraftId: f.effectiveAircraftId,
          crewId: f.effectiveCrewId,
          causeSummary: f.causeSummary,
          passengers: f.flight.passengers,
          causeChain: f.causeChain.map((s) => `${s.stepNumber}. ${s.title}: ${s.detail}`),
        })),
      topDelayedFlights: result.flights
        .filter((f) => f.status === 'DELAYED')
        .sort((a, b) => b.arrDelayMin - a.arrDelayMin)
        .slice(0, 12)
        .map((f) => ({
          flightId: f.flight.id,
          route: `${f.flight.origin}->${f.flight.dest}`,
          aircraftId: f.effectiveAircraftId,
          crewId: f.effectiveCrewId,
          arrDelayMin: f.arrDelayMin,
          rootCause: f.rootCause,
          causeSummary: f.causeSummary,
        })),
      strandedByAirport: dataset.airports
        .map((ap) => {
          const cxlPax = result.flights
            .filter((f) => f.flight.origin === ap.code && f.status === 'CANCELLED')
            .reduce((s, f) => s + f.cancelledLocalPax, 0);
          const connPax = result.connections
            .filter((c) => c.connection.airportCode === ap.code && c.status === 'MISSED_DELAY')
            .reduce((s, c) => s + c.strandedPassengers, 0);
          return { airportCode: ap.code, city: ap.city, totalStranded: cxlPax + connPax, cxlPax, connPax };
        })
        .filter((x) => x.totalStranded > 0)
        .sort((a, b) => b.totalStranded - a.totalStranded),
      topRecoveryCandidates: candidatePlans.slice(0, 5).map((p) => ({
        title: p.title,
        category: p.category,
        deltas: p.deltas,
        after: {
          strandedPassengers: p.after.strandedPassengers,
          cancelledFlights: p.after.cancelledFlights,
          totalDelayMinutes: p.after.totalDelayMinutes,
          crewBreachesCount: p.after.crewBreachesCount,
        },
      })),
    };

    const res = await fetch('/api/dispatcher/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Server error (${res.status})`);
    }
    return data.answer as string;
  };

  const handlePrimaryHeaderCTA = () => {
    if (!disruption) {
      updateDisruption(PRESET_SCENARIOS[0].disruption, parseTime('15:30'));
      setActiveView('map');
      setMapSideTab('recovery');
      return;
    }
    if (activeView === 'map') {
      setMapSideTab('recovery');
    } else {
      setActiveView('dispatcher');
    }
    if (!aiResponse && !aiLoading) {
      void requestAIRecommendations();
    }
  };

  const [skyBackdropFailed, setSkyBackdropFailed] = useState(false);

  const handleLoadSavedScenario = (record: SavedScenarioRecord) => {
    const nextDisruption: DisruptionConfig = {
      airportCode: record.airportCode,
      startMin: record.startMin,
      endMin: record.endMin,
      reason: record.reason,
    };
    const nextBase = simulateNetwork(dataset, nextDisruption, []);
    const avail = generateAvailableActions(dataset, nextDisruption, nextBase);
    const matchedActions = record.actionIds
      .map((aid) => avail.find((a) => a.id === aid))
      .filter((a): a is RecoveryAction => Boolean(a));

    setDisruption(nextDisruption);
    setSecondaryDisruption(null);
    setDispatchPriority(record.priority);
    setActiveActions(matchedActions);
    setAiResponse(null);
    setAiError(null);
    setSelectedAirportCode(null);
    setSelectedFlightId(null);
    setIsPlaying(false);
    setCurrentTimeMin(Math.min(1320, nextDisruption.endMin + 300));
    setActiveView('map');
    setMapSideTab(matchedActions.length > 0 ? 'recovery' : 'cascade');
  };

  const handleActivateComparedDisruption = (
    nextDisruption: DisruptionConfig,
    actionIds: string[] = [],
    nextSecondary: DisruptionConfig | null = null
  ) => {
    const nextBase = simulateNetwork(dataset, nextDisruption, [], nextSecondary);
    const avail = generateAvailableActions(dataset, nextDisruption, nextBase, nextSecondary);
    const matchedActions = actionIds
      .map((aid) => avail.find((a) => a.id === aid))
      .filter((a): a is RecoveryAction => Boolean(a));

    setDisruption(nextDisruption);
    setSecondaryDisruption(nextSecondary);
    setActiveActions(matchedActions);
    setAiResponse(null);
    setAiError(null);
    setSelectedAirportCode(null);
    setSelectedFlightId(null);
    setIsPlaying(false);
    setCurrentTimeMin(Math.min(1320, Math.max(nextDisruption.endMin, nextSecondary?.endMin ?? 0) + 300));
    setActiveView('map');
  };

  const handleImportDataset = (newDs: NetworkDataset) => {
    setDataset(newDs);
    setIsCustomDataset(true);
    setActiveActions([]);
    setAiResponse(null);
    setAiError(null);
    setSelectedFlightId(null);
    setSelectedAirportCode(null);
    if (
      newDs.airports.length > 0 &&
      disruption &&
      !newDs.airports.some((a) => a.code === disruption.airportCode)
    ) {
      setDisruption({
        airportCode: newDs.airports[0].code,
        startMin: parseTime('08:00'),
        endMin: parseTime('09:30'),
        reason: 'Thunderstorm',
      });
    }
    if (
      secondaryDisruption &&
      !newDs.airports.some((a) => a.code === secondaryDisruption.airportCode)
    ) {
      setSecondaryDisruption(null);
    }
  };

  const handleExportPostMortem = () => {
    const dispatcherLabel = profile
      ? `${profile.displayName} (${profile.callsign} · ${profile.homeHub})`
      : 'Guest OCC Dispatcher';
    exportExecutiveBriefingMarkdown(dataset, baseline, result, dispatcherLabel);
  };

  const handleQuickSaveScenario = async () => {
    if (!disruption) return;
    const title = `${disruption.airportCode}${secondaryDisruption ? `+${secondaryDisruption.airportCode}` : ''} ${
      disruption.endMin - disruption.startMin
    }m ${disruption.reason}${activeActions.length > 0 ? ` (${activeActions.length} Recovery)` : ''}`;
    await cloudWorkspace.saveScenario({
      title,
      notes: secondaryDisruption
        ? `Rolling 2nd disruption: ${secondaryDisruption.airportCode} ${formatTime(secondaryDisruption.startMin)}-${formatTime(
            secondaryDisruption.endMin
          )} (${secondaryDisruption.reason})`
        : '',
      disruption,
      priority: dispatchPriority,
      actions: activeActions,
      baseline,
      result,
    });
    setQuickSaveDone(true);
    window.setTimeout(() => setQuickSaveDone(false), 3000);
  };

  const hasRecovery = activeActions.length > 0;
  const currentDuration = disruption ? disruption.endMin - disruption.startMin : 90;
  const secondaryDuration = secondaryDisruption ? secondaryDisruption.endMin - secondaryDisruption.startMin : 90;

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0C2D57] via-[#2B5876] to-[#C89B7B] text-white">
        <div className="flex items-center gap-2.5 text-sm font-medium bg-slate-950/60 backdrop-blur-xl border border-white/15 px-5 py-3 rounded-xl">
          <Loader2 className="w-4 h-4 animate-spin text-sky-300" />
          <span>Initializing Domino Sky OCC...</span>
        </div>
      </div>
    );
  }

  if (!user && showLoginPortal) {
    return <LoginPortal />;
  }

  return (
    <div className="relative min-h-screen flex flex-col bg-gradient-to-b from-slate-900 via-sky-950 to-slate-900 text-slate-900">
      {/* Full-Viewport Panoramic Golden-Twilight Sky Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-gradient-to-b from-[#0C2D57] via-[#2B5876] to-[#C89B7B]"
      >
        {!skyBackdropFailed && (
          <img
            src={SKY_BACKDROP_SRC}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setSkyBackdropFailed(true)}
            className="w-full h-full object-cover object-center opacity-100 scale-[1.01]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/35 via-slate-900/12 to-slate-950/42" />
      </div>

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-slate-950/65 backdrop-blur-xl border-b border-white/15 px-6 h-14 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveView('map')}
          className="text-lg font-extrabold font-display tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          Domino Sky
        </button>

        {/* Zone 2: 5 Clean Single-Line Text Navigation Links */}
        <nav className="flex items-center gap-6 h-full overflow-x-auto" aria-label="Primary">
          {(
            [
              { id: 'map', label: 'Network Map' },
              { id: 'timeline', label: 'Fleet Timeline' },
              { id: 'ledger', label: 'Flight Ledger' },
              { id: 'dispatcher', label: 'AI Dispatcher' },
              { id: 'ops', label: 'Ops Hub' },
            ] as const
          ).map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`h-full flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'border-sky-400 text-white'
                    : 'border-transparent text-slate-300 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary CTA Button */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={handlePrimaryHeaderCTA}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 shadow-sm cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Recommend Recovery
          </button>
        </div>
      </header>

      {/* Main Operational Workspace */}
      <main className="relative z-10 flex-1 max-w-[1480px] w-full mx-auto px-6 py-5 space-y-4">
        {/* Disruption Control Ribbon */}
        <section
          aria-label="Airport closure controls"
          className="bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 shadow-[0_8px_30px_rgba(15,23,42,0.14)]"
        >
          <div className="flex flex-wrap items-center gap-3">
            {/* Airport Selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="airport-select" className="text-xs font-medium text-slate-500 whitespace-nowrap">
                Close Airport
              </label>
              <select
                id="airport-select"
                value={disruption?.airportCode ?? 'NONE'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'NONE') {
                    updateDisruption(null);
                  } else {
                    const start = disruption?.startMin ?? parseTime('08:00');
                    const dur = disruption ? disruption.endMin - disruption.startMin : 90;
                    updateDisruption({
                      airportCode: val,
                      startMin: start,
                      endMin: start + dur,
                      reason: disruption?.reason ?? 'Thunderstorm',
                    });
                  }
                }}
                className="px-2.5 py-1.5 text-xs font-mono font-medium border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="NONE">None (Clear Skies)</option>
                {dataset.airports.map((ap) => (
                  <option key={ap.code} value={ap.code}>
                    {ap.code} · {ap.city}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Time */}
            {disruption && (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor="start-time-select" className="text-xs font-medium text-slate-500 whitespace-nowrap">
                    From
                  </label>
                  <select
                    id="start-time-select"
                    value={disruption.startMin}
                    onChange={(e) => {
                      const nextStart = Number(e.target.value);
                      updateDisruption({
                        ...disruption,
                        startMin: nextStart,
                        endMin: nextStart + currentDuration,
                      });
                    }}
                    className="px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {START_TIME_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatTime(m)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Duration Segmented Control */}
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                  {DURATION_OPTIONS.map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() =>
                        updateDisruption({
                          ...disruption,
                          endMin: disruption.startMin + dur,
                        })
                      }
                      className={`px-2.5 py-1 text-xs font-mono tabular-nums font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        currentDuration === dur
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>

                {/* Cause Selector */}
                <select
                  aria-label="Disruption cause"
                  value={disruption.reason}
                  onChange={(e) =>
                    updateDisruption({
                      ...disruption,
                      reason: e.target.value as DisruptionConfig['reason'],
                    })
                  }
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  {REASON_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                {/* Rolling 2nd Disruption Toggle */}
                {!secondaryDisruption && (
                  <button
                    type="button"
                    onClick={handleAddSecondaryDisruption}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-amber-400 bg-amber-50/70 hover:bg-amber-100/80 text-amber-900 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add 2nd Weather Event</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Preset Scenarios */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-1">Presets:</span>
            {PRESET_SCENARIOS.map((preset) => {
              const samePrimary =
                disruption?.airportCode === preset.disruption.airportCode &&
                disruption?.startMin === preset.disruption.startMin &&
                disruption?.endMin === preset.disruption.endMin;
              const presetSec = preset.secondaryDisruption ?? null;
              const sameSecondary =
                (secondaryDisruption === null && presetSec === null) ||
                (secondaryDisruption !== null &&
                  presetSec !== null &&
                  secondaryDisruption.airportCode === presetSec.airportCode &&
                  secondaryDisruption.startMin === presetSec.startMin);
              const isSelected = samePrimary && sameSecondary;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    const latestEnd = Math.max(
                      preset.disruption.endMin,
                      preset.secondaryDisruption?.endMin ?? 0
                    );
                    updateDisruption(
                      preset.disruption,
                      Math.min(1320, latestEnd + 300),
                      preset.secondaryDisruption ?? null
                    );
                    if (preset.id === 'bom-storm') setSelectedFlightId('DS-105');
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            {disruption && (
              <button
                type="button"
                onClick={() => updateDisruption(null)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>

          {/* Secondary Rolling Disruption Row (Multi-Airport Weather Stacking) */}
          {disruption && secondaryDisruption && (
            <div className="w-full pt-2.5 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-3 bg-amber-50/55 -mx-1 px-3 py-2 rounded-lg">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900 whitespace-nowrap">
                  2nd Rolling Event
                </span>

                <select
                  aria-label="Second airport closure"
                  value={secondaryDisruption.airportCode}
                  onChange={(e) =>
                    handleUpdateSecondaryDisruption({
                      ...secondaryDisruption,
                      airportCode: e.target.value,
                    })
                  }
                  className="px-2.5 py-1 text-xs font-mono font-medium border border-amber-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-amber-600"
                >
                  {dataset.airports.map((ap) => (
                    <option key={ap.code} value={ap.code}>
                      {ap.code} · {ap.city}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-500">From</span>
                  <select
                    aria-label="Second disruption start time"
                    value={secondaryDisruption.startMin}
                    onChange={(e) => {
                      const nextStart = Number(e.target.value);
                      handleUpdateSecondaryDisruption({
                        ...secondaryDisruption,
                        startMin: nextStart,
                        endMin: nextStart + secondaryDuration,
                      });
                    }}
                    className="px-2 py-1 text-xs font-mono tabular-nums border border-amber-300 rounded-lg bg-white text-slate-900"
                  >
                    {START_TIME_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatTime(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1 p-0.5 bg-amber-100/80 rounded-lg">
                  {DURATION_OPTIONS.map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() =>
                        handleUpdateSecondaryDisruption({
                          ...secondaryDisruption,
                          endMin: secondaryDisruption.startMin + dur,
                        })
                      }
                      className={`px-2 py-0.5 text-xs font-mono tabular-nums font-medium rounded-md transition-colors cursor-pointer ${
                        secondaryDuration === dur
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-amber-900/70 hover:text-amber-950'
                      }`}
                    >
                      {dur}m
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Second disruption cause"
                  value={secondaryDisruption.reason}
                  onChange={(e) =>
                    handleUpdateSecondaryDisruption({
                      ...secondaryDisruption,
                      reason: e.target.value as DisruptionConfig['reason'],
                    })
                  }
                  className="px-2 py-1 text-xs border border-amber-300 rounded-lg bg-white text-slate-800"
                >
                  {REASON_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleUpdateSecondaryDisruption(null)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-900 hover:bg-amber-200/60 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Remove 2nd Event</span>
              </button>
            </div>
          )}

          {/* Natural-Language AI Scenario Prompt Bar */}
          <form
            onSubmit={handleParseScenario}
            className="w-full pt-2.5 mt-0.5 border-t border-slate-100 flex flex-wrap items-center gap-2"
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
              <Wand2 className="w-3.5 h-3.5 text-blue-700" />
              <span>AI Scenario</span>
            </div>
            <input
              type="text"
              value={scenarioPrompt}
              onChange={(e) => setScenarioPrompt(e.target.value)}
              placeholder='Describe any disruption, e.g. "2-hour fog closes Delhi at 06:30, zero cancellations" or "Kolkata thunderstorm 11:00-13:00"'
              className="flex-1 min-w-[260px] px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50/70 focus:bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={scenarioLoading || !scenarioPrompt.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              {scenarioLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {scenarioLoading ? 'Interpreting...' : 'Simulate'}
            </button>
            {scenarioNote && (
              <span className="text-[11px] text-emerald-700 font-medium">{scenarioNote}</span>
            )}
            {scenarioError && (
              <span className="text-[11px] text-rose-600 font-medium">{scenarioError}</span>
            )}
          </form>

          {/* Compact Operator Desk Strip: Cloud Status, Quick Save, CSV Export, Account */}
          <div className="w-full pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-600">
              {user && profile ? (
                <button
                  type="button"
                  onClick={() => setActiveView('ops')}
                  className="flex items-center gap-2 text-slate-800 hover:text-blue-700 transition-colors cursor-pointer"
                >
                  <Cloud className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-semibold">{profile.displayName}</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {profile.callsign} · {profile.homeHub}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2 text-slate-600">
                  <span>Guest Simulator Mode</span>
                  <button
                    type="button"
                    onClick={openLoginPortal}
                    className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Sign in with Google</span>
                  </button>
                </div>
              )}
              <span className="text-slate-300" aria-hidden="true">|</span>
              <button
                type="button"
                onClick={() => setActiveView('ops')}
                className="font-mono text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                {cloudWorkspace.scenarios.length} Playbooks · {cloudWorkspace.logEntries.filter((e) => e.status === 'open').length} Open Logs
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDatasetModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-blue-700" />
                <span>{isCustomDataset ? 'Custom Dataset ✓' : 'Upload JSON Dataset'}</span>
              </button>
              {disruption && (
                <button
                  type="button"
                  onClick={() => void handleQuickSaveScenario()}
                  disabled={cloudWorkspace.syncBusy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                >
                  {quickSaveDone ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 font-semibold">Saved</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5 text-blue-700" />
                      <span>Save Playbook</span>
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleExportPostMortem}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-blue-700" />
                <span>Post-Mortem Brief</span>
              </button>
              <button
                type="button"
                onClick={() => exportFlightManifestCsv(result, baseline)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Export CSV</span>
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50 text-xs font-medium transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Full-Width Deterministic 6-Column KPI Strip (With Live Before -> After Deltas & Financial Cost) */}
        <section
          aria-label="Deterministic network metrics"
          className="bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 shadow-[0_8px_30px_rgba(15,23,42,0.14)]"
        >
          {/* 1. Delayed Flights */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Delayed Flights</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-xl font-bold ${
                  result.summary.delayedFlights > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {result.summary.delayedFlights}
              </span>
              <span className="text-xs text-slate-400">/ {result.summary.totalFlights}</span>
              {hasRecovery && baseline.summary.delayedFlights !== result.summary.delayedFlights && (
                <span className="text-xs font-semibold text-emerald-700">
                  {formatDelta(result.summary.delayedFlights - baseline.summary.delayedFlights)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              {result.summary.onTimeFlights} on time · avg +{result.summary.avgDelayPerDelayedFlight}m
            </div>
          </div>

          {/* 2. Cancelled Flights */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Cancelled Flights</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-xl font-bold ${
                  result.summary.cancelledFlights > 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {result.summary.cancelledFlights}
              </span>
              {hasRecovery && baseline.summary.cancelledFlights !== result.summary.cancelledFlights && (
                <span className="text-xs font-semibold text-emerald-700">
                  was {baseline.summary.cancelledFlights} ({formatDelta(result.summary.cancelledFlights - baseline.summary.cancelledFlights)})
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              {result.summary.fdtlCancelledFlights} crew FDTL · {result.summary.recoveryCancelledFlights} recovery
            </div>
          </div>

          {/* 3. Total Network Delay */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Total Delay Minutes</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-xl font-bold text-slate-900">
                {result.summary.totalDelayMinutes.toLocaleString()}m
              </span>
              {hasRecovery && baseline.summary.totalDelayMinutes !== result.summary.totalDelayMinutes && (
                <span
                  className={`text-xs font-semibold ${
                    result.summary.totalDelayMinutes < baseline.summary.totalDelayMinutes
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {formatDelta(result.summary.totalDelayMinutes - baseline.summary.totalDelayMinutes, 'm')}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              {formatDuration(result.summary.totalDelayMinutes)} cumulative · max +{result.summary.maxDelayMinutes}m
            </div>
          </div>

          {/* 4. Stranded Passengers */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Stranded Passengers</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-xl font-bold ${
                  result.summary.strandedPassengers > 0 ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                {result.summary.strandedPassengers.toLocaleString()}
              </span>
              {hasRecovery && baseline.summary.strandedPassengers !== result.summary.strandedPassengers && (
                <span className="text-xs font-semibold text-emerald-700">
                  {formatDelta(result.summary.strandedPassengers - baseline.summary.strandedPassengers)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              {result.summary.strandedFromCancellations} cxl · {result.summary.strandedFromMissedConnections} missed conn
            </div>
          </div>

          {/* 5. Crew FDTL Breaches & Spread */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Crew Duty Breaches</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-xl font-bold ${
                  result.summary.crewBreachesCount > 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {result.summary.crewBreachesCount}
              </span>
              <span className="text-xs text-slate-400">/ {dataset.crews.length} crews</span>
              {hasRecovery && baseline.summary.crewBreachesCount !== result.summary.crewBreachesCount && (
                <span className="text-xs font-semibold text-emerald-700">
                  {formatDelta(result.summary.crewBreachesCount - baseline.summary.crewBreachesCount)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              {result.summary.affectedAirportsCount} / {dataset.airports.length} airports impacted
            </div>
          </div>

          {/* 6. Deterministic Financial & Operational Cost Estimator */}
          <div className="px-4 py-3">
            <div className="text-xs text-slate-500">Est. Disruption Cost</div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                className={`text-xl font-bold ${
                  result.summary.estimatedCostInr > 0 ? 'text-slate-900' : 'text-emerald-700'
                }`}
              >
                {formatInrCompact(result.summary.estimatedCostInr)}
              </span>
              {hasRecovery && baseline.summary.estimatedCostInr !== result.summary.estimatedCostInr && (
                <span
                  className={`text-xs font-semibold ${
                    result.summary.estimatedCostInr < baseline.summary.estimatedCostInr
                      ? 'text-emerald-700'
                      : 'text-rose-600'
                  }`}
                >
                  {formatInrDelta(result.summary.estimatedCostInr - baseline.summary.estimatedCostInr)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 font-mono tabular-nums">
              ₹8.5k/pax · ₹2.5L/cxl · ₹1.2k/m
            </div>
          </div>
        </section>

        {/* Active Watchlist Alert Bar (shown across views whenever starred flights are delayed or cancelled) */}
        {affectedWatchedFlights.length > 0 && activeView !== 'ledger' && (
          <section
            aria-label="Watchlist impact alert"
            className="bg-amber-50/92 backdrop-blur-xl border border-amber-200/90 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
          >
            <div className="flex flex-wrap items-center gap-2 text-slate-900">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="font-semibold">
                Watchlist: {affectedWatchedFlights.length} starred{' '}
                {affectedWatchedFlights.length === 1 ? 'flight' : 'flights'} impacted
              </span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
                {affectedWatchedFlights.slice(0, 4).map((sf) => (
                  <button
                    key={sf.flight.id}
                    type="button"
                    onClick={() => {
                      setSelectedFlightId(sf.flight.id);
                      setSelectedAirportCode(null);
                      setActiveView('map');
                      setMapSideTab('cascade');
                    }}
                    className={`hover:underline cursor-pointer ${
                      sf.status === 'CANCELLED' ? 'text-rose-700 font-semibold' : 'text-amber-800 font-medium'
                    }`}
                  >
                    {sf.flight.id} {sf.flight.origin}→{sf.flight.dest} (
                    {sf.status === 'CANCELLED' ? 'Cancelled' : `+${sf.arrDelayMin}m`})
                  </button>
                ))}
                {affectedWatchedFlights.length > 4 && (
                  <span className="text-slate-500">+{affectedWatchedFlights.length - 4} more</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={openWatchlistInLedger}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              View Watchlist ({watchlistIds.length})
            </button>
          </section>
        )}

        {/* === VIEW 1: INTERACTIVE NETWORK MAP + CASCADE/RECOVERY INSPECTOR + REGIONAL DELAY RADAR === */}
        {activeView === 'map' && (
          <div className="space-y-4">
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              <div className="lg:col-span-8 min-h-[600px]">
                <IndiaAirspaceMap
                  dataset={dataset}
                  result={result}
                  baseline={baseline}
                  currentTimeMin={currentTimeMin}
                  isPlaying={isPlaying}
                  playbackSpeed={playbackSpeed}
                  selectedFlightId={selectedFlightId}
                  selectedAirportCode={selectedAirportCode}
                  onSelectFlight={(id) => {
                    setSelectedFlightId(id);
                    if (id) {
                      setSelectedAirportCode(null);
                      setMapSideTab('cascade');
                    }
                  }}
                  onSelectAirport={(code) => {
                    setSelectedAirportCode(code);
                    if (code) {
                      setSelectedFlightId(null);
                      setMapSideTab('cascade');
                    }
                  }}
                  onTimeChange={(m) => {
                    setIsPlaying(false);
                    setCurrentTimeMin(m);
                  }}
                  onTogglePlay={() => {
                    if (currentTimeMin >= 1440) setCurrentTimeMin(300);
                    setIsPlaying((p) => !p);
                  }}
                  onSetSpeed={(speed) => setPlaybackSpeed(speed)}
                  onResetPlayback={() => {
                    setIsPlaying(false);
                    setCurrentTimeMin(300);
                  }}
                />
              </div>

              {/* Right Tabbed Deck: Cascade & Cause | AI Recovery */}
              <aside className="lg:col-span-4 bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl flex flex-col overflow-hidden h-[640px] shadow-[0_8px_30px_rgba(15,23,42,0.16)]">
                <div className="flex border-b border-slate-200 bg-slate-50/70 px-2 pt-2 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMapSideTab('cascade')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                      mapSideTab === 'cascade'
                        ? 'border-blue-700 text-slate-900 bg-white'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Cascade & Cause
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapSideTab('recovery')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                      mapSideTab === 'recovery'
                        ? 'border-blue-700 text-slate-900 bg-white'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    AI Recovery {activeActions.length > 0 ? `(${activeActions.length})` : ''}
                  </button>
                </div>

                <div className="flex-1 min-h-0">
                  {mapSideTab === 'cascade' ? (
                    <CascadeInspector
                      dataset={dataset}
                      result={result}
                      baseline={baseline}
                      selectedFlightId={selectedFlightId}
                      selectedAirportCode={selectedAirportCode}
                      availableActions={availableActions}
                      activeActions={activeActions}
                      watchlistIds={watchlistIds}
                      onToggleWatchlist={handleToggleWatchlist}
                      onSelectFlight={(id) => {
                        setSelectedFlightId(id);
                        if (id) setSelectedAirportCode(null);
                      }}
                      onSelectAirport={(code) => {
                        setSelectedAirportCode(code);
                        if (code) setSelectedFlightId(null);
                      }}
                      onCloseAirportPreset={handleCloseAirportFromMap}
                      onToggleAction={handleToggleAction}
                      onOpenAIDispatcher={() => {
                        setMapSideTab('recovery');
                        if (!aiResponse && !aiLoading) {
                          void requestAIRecommendations();
                        }
                      }}
                    />
                  ) : (
                    <AIDispatcherPanel
                      compact
                      dataset={dataset}
                      baseline={baseline}
                      result={result}
                      candidatePlans={candidatePlans}
                      availableActions={availableActions}
                      activeActions={activeActions}
                      dispatchPriority={dispatchPriority}
                      onChangePriority={setDispatchPriority}
                      aiResponse={aiResponse}
                      aiLoading={aiLoading}
                      aiError={aiError}
                      onRequestRecommendations={requestAIRecommendations}
                      onApplyPlan={(acts) => setActiveActions(acts)}
                      onToggleAction={handleToggleAction}
                      onClearActions={() => setActiveActions([])}
                      onAskDispatcher={handleAskDispatcher}
                      onGenerateComms={handleGenerateComms}
                      onExportPostMortem={handleExportPostMortem}
                    />
                  )}
                </div>
              </aside>
            </section>

            {/* Regional Delay Radar Polar Chart (16 Airports: Live Avg vs Historical Daily Avg) */}
            <RegionalDelayRadar
              dataset={dataset}
              result={result}
              baseline={baseline}
              currentTimeMin={currentTimeMin}
              selectedAirportCode={selectedAirportCode}
              hasRecovery={hasRecovery}
              onSelectAirport={(code) => {
                setSelectedAirportCode(code);
                setSelectedFlightId(null);
                setMapSideTab('cascade');
              }}
            />
          </div>
        )}

        {/* === VIEW 2: FLEET ROTATION GANTT TIMELINE === */}
        {activeView === 'timeline' && (
          <section className="space-y-4">
            <FleetTimelineView
              dataset={dataset}
              result={result}
              baseline={baseline}
              selectedFlightId={selectedFlightId}
              onSelectFlight={(id) => {
                setSelectedFlightId(id);
                setActiveView('map');
                setMapSideTab('cascade');
              }}
            />
          </section>
        )}

        {/* === VIEW 3: 70-FLIGHT LEDGER & DATASET === */}
        {activeView === 'ledger' && (
          <section>
            <FlightLedgerView
              dataset={dataset}
              result={result}
              baseline={baseline}
              watchlistIds={watchlistIds}
              watchlistFocusSignal={watchlistFocusSignal}
              onToggleWatchlist={handleToggleWatchlist}
              onClearWatchlist={() => setWatchlistIds([])}
              onSelectFlight={(id) => {
                setSelectedFlightId(id);
                setActiveView('map');
                setMapSideTab('cascade');
              }}
              onImportDataset={handleImportDataset}
              onResetDefaultDataset={() => {
                setDataset(DEFAULT_DATASET);
                setIsCustomDataset(false);
                updateDisruption(PRESET_SCENARIOS[0].disruption, parseTime('15:30'), null);
              }}
              isCustomDataset={isCustomDataset}
            />
          </section>
        )}

        {/* === VIEW 4: FULL-WIDTH AI DISPATCHER STUDIO === */}
        {activeView === 'dispatcher' && (
          <section>
            <AIDispatcherPanel
              dataset={dataset}
              baseline={baseline}
              result={result}
              candidatePlans={candidatePlans}
              availableActions={availableActions}
              activeActions={activeActions}
              dispatchPriority={dispatchPriority}
              onChangePriority={setDispatchPriority}
              aiResponse={aiResponse}
              aiLoading={aiLoading}
              aiError={aiError}
              onRequestRecommendations={requestAIRecommendations}
              onApplyPlan={(acts) => setActiveActions(acts)}
              onToggleAction={handleToggleAction}
              onClearActions={() => setActiveActions([])}
              onAskDispatcher={handleAskDispatcher}
              onGenerateComms={handleGenerateComms}
              onExportPostMortem={handleExportPostMortem}
            />
          </section>
        )}

        {/* === VIEW 5: OCC OPERATIONS HUB (PLAYBOOKS, LOGBOOK, COMPARE LAB, EXPORTS & ACCOUNT) === */}
        {activeView === 'ops' && (
          <section>
            <OpsHubView
              dataset={dataset}
              disruption={disruption}
              baseline={baseline}
              result={result}
              activeActions={activeActions}
              dispatchPriority={dispatchPriority}
              watchlistCount={watchlistIds.length}
              isCloudActive={cloudWorkspace.isCloudActive}
              syncBusy={cloudWorkspace.syncBusy}
              scenarios={cloudWorkspace.scenarios}
              logEntries={cloudWorkspace.logEntries}
              onSaveScenario={cloudWorkspace.saveScenario}
              onUpdateScenarioDetails={cloudWorkspace.updateScenarioDetails}
              onDeleteScenario={cloudWorkspace.deleteScenario}
              onLoadScenario={handleLoadSavedScenario}
              onActivateDisruption={handleActivateComparedDisruption}
              onAddLogEntry={cloudWorkspace.addLogEntry}
              onResolveLogEntry={cloudWorkspace.resolveLogEntry}
              onDeleteLogEntry={cloudWorkspace.deleteLogEntry}
            />
          </section>
        )}
      </main>

      {/* Live Watchlist Disruption Toast Notification */}
      <WatchlistToast
        event={watchlistToast}
        onDismiss={() => setWatchlistToast(null)}
        onInspectFlight={(flightId) => {
          setSelectedFlightId(flightId);
          setSelectedAirportCode(null);
          setActiveView('map');
          setMapSideTab('cascade');
          setWatchlistToast(null);
        }}
        onViewWatchlist={openWatchlistInLedger}
      />

      {/* Quick-Access Dataset JSON Uploader + Validator Modal */}
      <DatasetUploaderModal
        isOpen={showDatasetModal}
        currentDataset={dataset}
        onImportDataset={handleImportDataset}
        onClose={() => setShowDatasetModal(false)}
      />
    </div>
  );
}
