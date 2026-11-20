import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  ClipboardList,
  Cloud,
  CloudOff,
  Download,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Lock,
  LogIn,
  LogOut,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  UserCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PRESET_SCENARIOS } from '../data/networkDataset';
import { generateAvailableActions } from '../engine/optimizer';
import { simulateNetwork } from '../engine/simulator';
import {
  LogCategory,
  LogSeverity,
  SavedScenarioRecord,
  ShiftLogEntryRecord,
} from '../hooks/useCloudWorkspace';
import {
  DispatchPriority,
  DisruptionConfig,
  NetworkDataset,
  RecoveryAction,
  SimulationResult,
} from '../types/network';
import { exportExecutiveBriefingMarkdown, exportFlightManifestCsv } from '../utils/exportReports';
import { formatInrCompact } from '../utils/costEstimator';
import { formatDelta, formatTime } from '../utils/time';

type OpsSubTab = 'playbooks' | 'logbook' | 'compare' | 'account';

interface OpsHubViewProps {
  dataset: NetworkDataset;
  disruption: DisruptionConfig | null;
  baseline: SimulationResult;
  result: SimulationResult;
  activeActions: RecoveryAction[];
  dispatchPriority: DispatchPriority;
  watchlistCount: number;
  isCloudActive: boolean;
  syncBusy: boolean;
  scenarios: SavedScenarioRecord[];
  logEntries: ShiftLogEntryRecord[];
  onSaveScenario: (args: {
    title: string;
    notes: string;
    disruption: DisruptionConfig;
    priority: DispatchPriority;
    actions: RecoveryAction[];
    baseline: SimulationResult;
    result: SimulationResult;
  }) => Promise<void>;
  onUpdateScenarioDetails: (scenarioId: string, title: string, notes: string) => Promise<void>;
  onDeleteScenario: (scenarioId: string) => Promise<void>;
  onLoadScenario: (record: SavedScenarioRecord) => void;
  onActivateDisruption: (
    disruption: DisruptionConfig,
    actionIds?: string[],
    secondaryDisruption?: DisruptionConfig | null
  ) => void;
  onAddLogEntry: (args: {
    title: string;
    notes: string;
    category: LogCategory;
    severity: LogSeverity;
    scenarioRef: string;
  }) => Promise<void>;
  onResolveLogEntry: (entryId: string, resolvedNote: string) => Promise<void>;
  onDeleteLogEntry: (entryId: string) => Promise<void>;
}

interface CompareCandidate {
  id: string;
  label: string;
  source: 'LIVE' | 'PRESET' | 'PLAYBOOK';
  disruption: DisruptionConfig;
  secondaryDisruption?: DisruptionConfig | null;
  actionIds: string[];
  actionCount: number;
}

const LOG_CATEGORIES: { value: LogCategory; label: string }[] = [
  { value: 'INCIDENT', label: 'Incident' },
  { value: 'RECOVERY', label: 'Recovery' },
  { value: 'CREW_FDTL', label: 'Crew FDTL' },
  { value: 'HANDOVER', label: 'Shift Handover' },
];

const LOG_SEVERITIES: { value: LogSeverity; label: string }[] = [
  { value: 'ROUTINE', label: 'Routine' },
  { value: 'ADVISORY', label: 'Advisory' },
  { value: 'CRITICAL', label: 'Critical' },
];

function formatDateTimeShort(ms: number): string {
  try {
    return new Date(ms).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export const OpsHubView: React.FC<OpsHubViewProps> = ({
  dataset,
  disruption,
  baseline,
  result,
  activeActions,
  dispatchPriority,
  watchlistCount,
  isCloudActive,
  syncBusy,
  scenarios,
  logEntries,
  onSaveScenario,
  onUpdateScenarioDetails,
  onDeleteScenario,
  onLoadScenario,
  onActivateDisruption,
  onAddLogEntry,
  onResolveLogEntry,
  onDeleteLogEntry,
}) => {
  const { user, profile, signInWithGoogle, signOutUser, openLoginPortal, updateProfile, authLoading } = useAuth();
  const [subTab, setSubTab] = useState<OpsSubTab>('playbooks');

  // --- Save Scenario Form ---
  const suggestedTitle = disruption
    ? `${disruption.airportCode} ${disruption.endMin - disruption.startMin}m ${disruption.reason}${
        activeActions.length > 0 ? ` (${activeActions.length} Recovery)` : ''
      }`
    : '';
  const [saveTitle, setSaveTitle] = useState('');
  const [saveNotes, setSaveNotes] = useState('');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Inline scenario editing
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // --- Logbook Form & Filters ---
  const defaultScenarioRef = disruption
    ? `${disruption.airportCode} ${formatTime(disruption.startMin)}–${formatTime(disruption.endMin)} ${disruption.reason}`
    : 'Clear Skies Network';
  const [logTitle, setLogTitle] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logCategory, setLogCategory] = useState<LogCategory>('INCIDENT');
  const [logSeverity, setLogSeverity] = useState<LogSeverity>('ADVISORY');
  const [logFilterStatus, setLogFilterStatus] = useState<'ALL' | 'open' | 'resolved'>('ALL');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNoteInput, setResolveNoteInput] = useState('');

  // --- Scenario Comparison Lab ---
  const comparePool = useMemo<CompareCandidate[]>(() => {
    const list: CompareCandidate[] = [];
    if (disruption) {
      list.push({
        id: 'live-current',
        label: `Live: ${disruption.airportCode}${baseline.secondaryDisruption ? `+${baseline.secondaryDisruption.airportCode}` : ''} ${disruption.endMin - disruption.startMin}m ${disruption.reason}`,
        source: 'LIVE',
        disruption,
        secondaryDisruption: baseline.secondaryDisruption ?? null,
        actionIds: activeActions.map((a) => a.id),
        actionCount: activeActions.length,
      });
    }
    for (const preset of PRESET_SCENARIOS) {
      list.push({
        id: `preset-${preset.id}`,
        label: preset.label,
        source: 'PRESET',
        disruption: preset.disruption,
        secondaryDisruption: preset.secondaryDisruption ?? null,
        actionIds: [],
        actionCount: 0,
      });
    }
    for (const sc of scenarios.slice(0, 6)) {
      list.push({
        id: `saved-${sc.id}`,
        label: sc.title,
        source: 'PLAYBOOK',
        disruption: {
          airportCode: sc.airportCode,
          startMin: sc.startMin,
          endMin: sc.endMin,
          reason: sc.reason,
        },
        secondaryDisruption: null,
        actionIds: sc.actionIds,
        actionCount: sc.actionIds.length,
      });
    }
    return list;
  }, [disruption, baseline.secondaryDisruption, activeActions, scenarios]);

  const [selectedCompareIds, setSelectedCompareIds] = useState<string[]>([
    'preset-bom-storm',
    'preset-del-fog',
    'preset-blr-closure',
  ]);

  const comparedEvaluations = useMemo(() => {
    const selected = selectedCompareIds
      .map((id) => comparePool.find((c) => c.id === id))
      .filter((c): c is CompareCandidate => Boolean(c));

    return selected.map((cand) => {
      const baseSim = simulateNetwork(dataset, cand.disruption, [], cand.secondaryDisruption ?? null);
      let finalSim = baseSim;
      if (cand.actionIds.length > 0) {
        const avail = generateAvailableActions(dataset, cand.disruption, baseSim, cand.secondaryDisruption ?? null);
        const matched = cand.actionIds
          .map((aid) => avail.find((a) => a.id === aid))
          .filter((a): a is RecoveryAction => Boolean(a));
        if (matched.length > 0) {
          finalSim = simulateNetwork(dataset, cand.disruption, matched, cand.secondaryDisruption ?? null);
        }
      }
      return {
        candidate: cand,
        sim: finalSim,
      };
    });
  }, [selectedCompareIds, comparePool, dataset]);

  const maxCompareDelay = Math.max(1, ...comparedEvaluations.map((e) => e.sim.summary.totalDelayMinutes));
  const maxCompareStranded = Math.max(1, ...comparedEvaluations.map((e) => e.sim.summary.strandedPassengers));

  // --- Profile Settings Form ---
  const [profileName, setProfileName] = useState(profile?.displayName ?? '');
  const [profileCallsign, setProfileCallsign] = useState(profile?.callsign ?? 'OCC-BOM-01');
  const [profileHub, setProfileHub] = useState(profile?.homeHub ?? 'BOM');
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);

  // Sync profile inputs if profile arrives asynchronously
  React.useEffect(() => {
    if (profile) {
      setProfileName(profile.displayName);
      setProfileCallsign(profile.callsign);
      setProfileHub(profile.homeHub);
    }
  }, [profile]);

  const openLogCount = logEntries.filter((e) => e.status === 'open').length;

  const filteredLogs = useMemo(() => {
    return logEntries.filter((entry) => {
      if (logFilterStatus !== 'ALL' && entry.status !== logFilterStatus) return false;
      return true;
    });
  }, [logEntries, logFilterStatus]);

  const handleSaveCurrentScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disruption) return;
    const titleToUse = (saveTitle.trim() || suggestedTitle).slice(0, 100);
    await onSaveScenario({
      title: titleToUse,
      notes: saveNotes,
      disruption,
      priority: dispatchPriority,
      actions: activeActions,
      baseline,
      result,
    });
    setSaveTitle('');
    setSaveNotes('');
    setSaveNotice(`Saved "${titleToUse}"`);
    window.setTimeout(() => setSaveNotice(null), 4000);
  };

  const handleCreateLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logTitle.trim() || !logNotes.trim()) return;
    await onAddLogEntry({
      title: logTitle,
      notes: logNotes,
      category: logCategory,
      severity: logSeverity,
      scenarioRef: defaultScenarioRef,
    });
    setLogTitle('');
    setLogNotes('');
  };

  const toggleCompareSelection = (id: string) => {
    setSelectedCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({
      displayName: profileName,
      callsign: profileCallsign,
      homeHub: profileHub,
    });
    setProfileSavedMsg('Dispatcher profile updated in cloud.');
    window.setTimeout(() => setProfileSavedMsg(null), 3500);
  };

  const dispatcherExportLabel = profile
    ? `${profile.displayName} (${profile.callsign} · ${profile.homeHub})`
    : 'Guest OCC Dispatcher';

  return (
    <div className="bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.16)] overflow-hidden">
      {/* Ops Hub Header & Sub-Navigation */}
      <div className="px-5 pt-4 pb-0 border-b border-slate-200 bg-slate-50/75">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div>
            <h2 className="text-base font-bold font-display text-slate-900 tracking-tight">
              OCC Operations Hub
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Cloud-synced recovery playbooks, shift handover logbook, multi-scenario benchmark lab, and report exports.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {isCloudActive && profile ? (
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <Cloud className="w-4 h-4 shrink-0" />
                <span>
                  Cloud Synced · <span className="font-mono">{profile.callsign}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-600">
                <CloudOff className="w-4 h-4 shrink-0 text-slate-400" />
                <span>Guest Local Mode</span>
                <button
                  type="button"
                  onClick={openLoginPortal}
                  className="ml-1 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 4 Clean Sub-Tabs */}
        <div className="flex items-center gap-5 overflow-x-auto" role="tablist">
          {(
            [
              { id: 'playbooks', label: `Saved Playbooks (${scenarios.length})`, icon: BookmarkPlus },
              { id: 'logbook', label: `Shift Logbook (${openLogCount} open)`, icon: ClipboardList },
              { id: 'compare', label: 'Scenario Compare Lab', icon: GitCompareArrows },
              { id: 'account', label: 'Exports & Account', icon: Download },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSubTab(tab.id)}
                className={`flex items-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-blue-700 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* === TAB 1: SAVED RECOVERY PLAYBOOKS === */}
      {subTab === 'playbooks' && (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Save Current Simulation Panel */}
          <div className="lg:col-span-4 space-y-4">
            <form
              onSubmit={handleSaveCurrentScenario}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Save Active Simulation
                </h3>
                {disruption && (
                  <span className="text-[11px] font-mono text-slate-500">
                    {disruption.airportCode} {formatTime(disruption.startMin)}–{formatTime(disruption.endMin)}
                  </span>
                )}
              </div>

              {!disruption ? (
                <p className="text-xs text-slate-500 leading-relaxed">
                  Select an airport closure in the top disruption ribbon to snapshot a scenario and its recovery plan.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-lg bg-white border border-slate-200 text-center font-mono tabular-nums">
                    <div>
                      <div className="text-[10px] text-slate-500">Stranded</div>
                      <div className="text-xs font-bold text-slate-900">
                        {baseline.summary.strandedPassengers} → {result.summary.strandedPassengers}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Cancelled</div>
                      <div className="text-xs font-bold text-slate-900">
                        {baseline.summary.cancelledFlights} → {result.summary.cancelledFlights}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">Delay</div>
                      <div className="text-xs font-bold text-slate-900">
                        {result.summary.totalDelayMinutes}m
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="playbook-title" className="text-xs font-medium text-slate-700">
                      Playbook Title
                    </label>
                    <input
                      id="playbook-title"
                      type="text"
                      maxLength={100}
                      value={saveTitle}
                      onChange={(e) => setSaveTitle(e.target.value)}
                      placeholder={suggestedTitle}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="playbook-notes" className="text-xs font-medium text-slate-700">
                      Dispatch Notes (Optional)
                    </label>
                    <textarea
                      id="playbook-notes"
                      rows={3}
                      maxLength={500}
                      value={saveNotes}
                      onChange={(e) => setSaveNotes(e.target.value)}
                      placeholder="Record rationale for spare swap, standby crew, or selective cancellation..."
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600 resize-none"
                    />
                  </div>

                  <div className="text-[11px] text-slate-500">
                    Captures disruption window, priority (<span className="font-mono">{dispatchPriority}</span>), and{' '}
                    <span className="font-mono font-semibold text-slate-700">{activeActions.length}</span> active recovery{' '}
                    {activeActions.length === 1 ? 'action' : 'actions'}.
                  </div>

                  <button
                    type="submit"
                    disabled={syncBusy}
                    className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isCloudActive ? 'Save Playbook to Cloud' : 'Save Playbook Locally'}</span>
                  </button>

                  {saveNotice && (
                    <div className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{saveNotice}</span>
                    </div>
                  )}
                </>
              )}
            </form>
          </div>

          {/* Saved Playbooks List */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Saved Playbooks Library ({scenarios.length})
              </h3>
              {!isCloudActive && (
                <button
                  type="button"
                  onClick={openLoginPortal}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
                >
                  Sign in with Google to sync across devices
                </button>
              )}
            </div>

            {scenarios.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-700">No saved recovery playbooks yet</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Apply a recovery action on any disruption and save it on the left to build a reusable OCC playbook
                  library.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {scenarios.map((sc) => {
                  const isEditing = editingScenarioId === sc.id;
                  const strandedSaved = sc.baselineStranded - sc.afterStranded;
                  const delaySaved = sc.baselineDelayMin - sc.afterDelayMin;

                  return (
                    <article
                      key={sc.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 hover:border-slate-300 transition-colors"
                    >
                      {isEditing ? (
                        <div className="space-y-2.5">
                          <input
                            type="text"
                            maxLength={100}
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg"
                          />
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg resize-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await onUpdateScenarioDetails(sc.id, editTitle, editNotes);
                                setEditingScenarioId(null);
                              }}
                              className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                            >
                              Save Changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingScenarioId(null)}
                              className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 text-xs font-medium cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900">{sc.title}</h4>
                                <span className="text-[11px] font-mono text-slate-500">
                                  {sc.airportCode} · {formatTime(sc.startMin)}–{formatTime(sc.endMin)} · {sc.reason}
                                </span>
                              </div>
                              {sc.notes && (
                                <p className="text-xs text-slate-600 leading-relaxed">{sc.notes}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => onLoadScenario(sc)}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                <span>Load</span>
                              </button>
                              <button
                                type="button"
                                aria-label="Edit playbook details"
                                onClick={() => {
                                  setEditingScenarioId(sc.id);
                                  setEditTitle(sc.title);
                                  setEditNotes(sc.notes);
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Delete playbook"
                                onClick={() => void onDeleteScenario(sc.id)}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Deterministic Before -> After Metrics */}
                          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs font-mono tabular-nums">
                            <div>
                              <div className="text-[10px] font-sans text-slate-500">Stranded Pax</div>
                              <div className="font-semibold text-slate-900">
                                {sc.baselineStranded} → {sc.afterStranded}{' '}
                                {strandedSaved > 0 && (
                                  <span className="text-emerald-700">(-{strandedSaved})</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-sans text-slate-500">Cancelled Flights</div>
                              <div className="font-semibold text-slate-900">
                                {sc.baselineCancelled} → {sc.afterCancelled}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-sans text-slate-500">Total Delay</div>
                              <div className="font-semibold text-slate-900">
                                {sc.baselineDelayMin}m → {sc.afterDelayMin}m{' '}
                                {delaySaved > 0 && (
                                  <span className="text-emerald-700">(-{delaySaved}m)</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                            <div className="truncate">
                              {sc.actionLabels.length > 0
                                ? `Actions: ${sc.actionLabels.join(' · ')}`
                                : 'Baseline snapshot (no recovery actions)'}
                            </div>
                            <span className="font-mono shrink-0">{formatDateTimeShort(sc.createdAtMs)}</span>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === TAB 2: OCC SHIFT HANDOVER & INCIDENT LOGBOOK === */}
      {subTab === 'logbook' && (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* New Log Entry Form */}
          <form
            onSubmit={handleCreateLog}
            className="lg:col-span-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 h-fit"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              New OCC Log Entry
            </h3>

            <div className="space-y-1">
              <label htmlFor="log-title" className="text-xs font-medium text-slate-700">
                Headline
              </label>
              <input
                id="log-title"
                type="text"
                required
                maxLength={120}
                value={logTitle}
                onChange={(e) => setLogTitle(e.target.value)}
                placeholder="e.g. Swap VT-SP1 onto DS-103 to protect BLR->CCU"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="log-category" className="text-xs font-medium text-slate-700">
                  Category
                </label>
                <select
                  id="log-category"
                  value={logCategory}
                  onChange={(e) => setLogCategory(e.target.value as LogCategory)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                >
                  {LOG_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="log-severity" className="text-xs font-medium text-slate-700">
                  Severity
                </label>
                <select
                  id="log-severity"
                  value={logSeverity}
                  onChange={(e) => setLogSeverity(e.target.value as LogSeverity)}
                  className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900"
                >
                  {LOG_SEVERITIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="log-notes" className="text-xs font-medium text-slate-700">
                Operational Details
              </label>
              <textarea
                id="log-notes"
                rows={4}
                required
                maxLength={1000}
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="Document crew FDTL margins, gate reassignments, or handover instructions for the incoming shift..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600 resize-none"
              />
            </div>

            <div className="text-[11px] text-slate-500 font-mono">
              Scenario tag: {defaultScenarioRef}
            </div>

            <button
              type="submit"
              disabled={syncBusy || !logTitle.trim() || !logNotes.trim()}
              className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Shift Entry</span>
            </button>
          </form>

          {/* Logbook Timeline List */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Operational Logbook ({filteredLogs.length})
              </h3>
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg text-xs">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'open', label: `Open (${openLogCount})` },
                    { id: 'resolved', label: `Resolved (${logEntries.length - openLogCount})` },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setLogFilterStatus(f.id)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      logFilterStatus === f.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center space-y-1.5">
                <p className="text-sm font-semibold text-slate-700">No shift log entries match this filter</p>
                <p className="text-xs text-slate-500">
                  Record crew FDTL alerts, recovery approvals, or shift handovers on the left. Resolved entries are
                  permanently locked for audit integrity.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredLogs.map((entry) => {
                  const isResolving = resolvingId === entry.id;
                  const sevColor =
                    entry.severity === 'CRITICAL'
                      ? 'text-rose-700'
                      : entry.severity === 'ADVISORY'
                        ? 'text-amber-700'
                        : 'text-slate-600';

                  return (
                    <article
                      key={entry.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase">
                            <span className={`font-bold ${sevColor}`}>{entry.severity}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-600 font-semibold">{entry.category.replace('_', ' ')}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500">{formatDateTimeShort(entry.createdAtMs)}</span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900">{entry.title}</h4>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {entry.status === 'resolved' ? (
                            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <Lock className="w-3.5 h-3.5" />
                              <span>Resolved · Locked</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingId(isResolving ? null : entry.id);
                                setResolveNoteInput('');
                              }}
                              className="px-2.5 py-1 rounded-md border border-emerald-300 text-emerald-800 hover:bg-emerald-50 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              Resolve & Lock
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label="Delete log entry"
                            onClick={() => void onDeleteLogEntry(entry.id)}
                            className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{entry.notes}</p>

                      {entry.scenarioRef && (
                        <div className="text-[11px] font-mono text-slate-500">
                          Context: {entry.scenarioRef}
                        </div>
                      )}

                      {entry.status === 'resolved' && entry.resolvedNote && (
                        <div className="rounded-lg bg-emerald-50/80 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
                          <span className="font-semibold">Resolution Sign-Off:</span> {entry.resolvedNote}
                        </div>
                      )}

                      {isResolving && entry.status === 'open' && (
                        <div className="pt-2 border-t border-slate-100 space-y-2">
                          <input
                            type="text"
                            maxLength={400}
                            value={resolveNoteInput}
                            onChange={(e) => setResolveNoteInput(e.target.value)}
                            placeholder="Resolution sign-off note (locks entry permanently)..."
                            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await onResolveLogEntry(entry.id, resolveNoteInput || 'Resolved by OCC dispatcher.');
                                setResolvingId(null);
                                setResolveNoteInput('');
                              }}
                              className="px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                            >
                              Confirm Resolution
                            </button>
                            <button
                              type="button"
                              onClick={() => setResolvingId(null)}
                              className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 text-xs cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === TAB 3: SIDE-BY-SIDE SCENARIO COMPARISON LAB === */}
      {subTab === 'compare' && (
        <div className="p-5 space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Select up to 4 Scenarios to Benchmark Deterministically
              </h3>
              <span className="text-xs font-mono text-slate-500">
                {selectedCompareIds.length} / 4 selected
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {comparePool.map((cand) => {
                const isSelected = selectedCompareIds.includes(cand.id);
                return (
                  <button
                    key={cand.id}
                    type="button"
                    onClick={() => toggleCompareSelection(cand.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {cand.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="py-3 px-4 font-semibold text-slate-600 w-48">Deterministic Metric</th>
                  {comparedEvaluations.map(({ candidate }) => (
                    <th key={candidate.id} className="py-3 px-4 font-bold text-slate-900 min-w-[200px]">
                      <div className="text-xs font-bold text-slate-900">{candidate.label}</div>
                      <div className="text-[11px] font-mono font-normal text-slate-500 mt-0.5">
                        {candidate.disruption.airportCode} · {formatTime(candidate.disruption.startMin)}–
                        {formatTime(candidate.disruption.endMin)}
                        {candidate.actionCount > 0 ? ` · ${candidate.actionCount} actions` : ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Stranded Passengers</td>
                  {comparedEvaluations.map(({ candidate, sim }) => {
                    const pct = Math.round((sim.summary.strandedPassengers / maxCompareStranded) * 100);
                    return (
                      <td key={candidate.id} className="py-3 px-4">
                        <div className="font-bold text-rose-700">{sim.summary.strandedPassengers.toLocaleString()}</div>
                        <div className="mt-1 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-rose-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Total Delay Minutes</td>
                  {comparedEvaluations.map(({ candidate, sim }) => {
                    const pct = Math.round((sim.summary.totalDelayMinutes / maxCompareDelay) * 100);
                    return (
                      <td key={candidate.id} className="py-3 px-4">
                        <div className="font-bold text-slate-900">{sim.summary.totalDelayMinutes.toLocaleString()}m</div>
                        <div className="mt-1 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Delayed Flights</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 font-semibold text-amber-700">
                      {sim.summary.delayedFlights} / {sim.summary.totalFlights} (avg +{sim.summary.avgDelayPerDelayedFlight}m)
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Cancelled Flights</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 font-semibold text-rose-700">
                      {sim.summary.cancelledFlights} ({sim.summary.fdtlCancelledFlights} FDTL)
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Broken Connections</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 text-slate-800">
                      {sim.summary.brokenConnectionsCount} / {sim.summary.totalConnectionsCount}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Crew Duty Breaches</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 text-slate-800">
                      {sim.summary.crewBreachesCount} / {dataset.crews.length}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Impacted Airports</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 text-slate-800">
                      {sim.summary.affectedAirportsCount} / {dataset.airports.length}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Est. Disruption Cost</td>
                  {comparedEvaluations.map(({ candidate, sim }) => (
                    <td key={candidate.id} className="py-3 px-4 font-bold text-slate-900">
                      {formatInrCompact(sim.summary.estimatedCostInr)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-slate-50/50">
                  <td className="py-3 px-4 font-sans font-medium text-slate-600">Simulator Action</td>
                  {comparedEvaluations.map(({ candidate }) => (
                    <td key={candidate.id} className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() =>
                          onActivateDisruption(
                            candidate.disruption,
                            candidate.actionIds,
                            candidate.secondaryDisruption ?? null
                          )
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-sans text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        <span>Activate in Simulator</span>
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === TAB 4: OPERATIONAL EXPORTS & DISPATCHER ACCOUNT === */}
      {subTab === 'account' && (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Operational Reports & Exports */}
          <div className="lg:col-span-6 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">One-Click Operational Exports</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Export deterministic simulation tables and executive sitreps directly from the active network state.
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs font-mono tabular-nums space-y-1 text-slate-700">
                <div>
                  Active Scope:{' '}
                  <span className="font-semibold text-slate-900">{defaultScenarioRef}</span>
                </div>
                <div>
                  Status: {result.summary.delayedFlights} delayed · {result.summary.cancelledFlights} cancelled ·{' '}
                  {result.summary.strandedPassengers} stranded ({formatDelta(result.summary.strandedPassengers - baseline.summary.strandedPassengers)} vs baseline)
                </div>
                <div>
                  Watchlist: {watchlistCount} starred flights · Saved Playbooks: {scenarios.length}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => exportFlightManifestCsv(result, baseline)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export 70-Flight CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportExecutiveBriefingMarkdown(dataset, baseline, result, dispatcherExportLabel)
                  }
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Export Briefing (.md)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Dispatcher Profile & Authentication */}
          <div className="lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {user && profile ? (
                <>
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3 min-w-0">
                      {profile.photoURL ? (
                        <img
                          src={profile.photoURL}
                          alt={profile.displayName}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <UserCircle2 className="w-10 h-10 text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">{profile.displayName}</div>
                        <div className="text-xs text-slate-500 truncate">{profile.email}</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void signOutUser()}
                      disabled={authLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-rose-300 hover:text-rose-700 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>

                  <form onSubmit={handleSaveProfile} className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor="prof-name" className="text-xs font-medium text-slate-700">
                        Dispatcher Name
                      </label>
                      <input
                        id="prof-name"
                        type="text"
                        maxLength={80}
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="prof-callsign" className="text-xs font-medium text-slate-700">
                          OCC Desk Callsign
                        </label>
                        <input
                          id="prof-callsign"
                          type="text"
                          maxLength={40}
                          value={profileCallsign}
                          onChange={(e) => setProfileCallsign(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="prof-hub" className="text-xs font-medium text-slate-700">
                          Home Hub
                        </label>
                        <select
                          id="prof-hub"
                          value={profileHub}
                          onChange={(e) => setProfileHub(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                        >
                          {dataset.airports.map((ap) => (
                            <option key={ap.code} value={ap.code}>
                              {ap.code} · {ap.city}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Save Profile
                      </button>
                      {profileSavedMsg && (
                        <span className="text-xs text-emerald-700 font-medium">{profileSavedMsg}</span>
                      )}
                    </div>
                  </form>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <UserCircle2 className="w-10 h-10 text-slate-400 shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Guest Simulator Session</h3>
                      <p className="text-xs text-slate-600">
                        Sign in with Google to persist playbooks, watchlist stars, and shift logbooks in Cloud Firestore.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signInWithGoogle()}
                    disabled={authLoading}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign in with Google</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
