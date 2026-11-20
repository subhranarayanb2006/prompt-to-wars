import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  RotateCcw,
  Send,
  AlertCircle,
  Loader2,
  SlidersHorizontal,
  ArrowRight,
  Volume2,
  Square,
  Megaphone,
  Copy,
  Check,
  ShieldCheck,
  Code2,
  FileText,
  Plus,
  X,
  Trophy,
  Scale,
} from 'lucide-react';
import {
  AICommsResponse,
  AIDispatcherResponse,
  CandidatePlanEvaluation,
  DispatchPriority,
  NetworkDataset,
  RecoveryAction,
  RecoveryActionType,
  SimulationResult,
} from '../types/network';
import { formatDelta, formatTime } from '../utils/time';
import { COST_WEIGHTS_INR, formatInrCompact, formatInrDelta } from '../utils/costEstimator';
import { useVoiceBriefing } from '../hooks/useVoiceBriefing';
import { AirportDelayChart } from './AirportDelayChart';
import { NetworkResilienceReport } from './NetworkResilienceReport';

interface AIDispatcherPanelProps {
  compact?: boolean;
  dataset: NetworkDataset;
  baseline: SimulationResult;
  result: SimulationResult;
  candidatePlans: CandidatePlanEvaluation[];
  availableActions: RecoveryAction[];
  activeActions: RecoveryAction[];
  dispatchPriority: DispatchPriority;
  onChangePriority: (p: DispatchPriority) => void;
  aiResponse: AIDispatcherResponse | null;
  aiLoading: boolean;
  aiError: string | null;
  onRequestRecommendations: (overridePriority?: DispatchPriority) => void;
  onApplyPlan: (actions: RecoveryAction[]) => void;
  onToggleAction: (action: RecoveryAction) => void;
  onClearActions: () => void;
  onAskDispatcher: (question: string) => Promise<string>;
  onGenerateComms: () => Promise<AICommsResponse>;
  onExportPostMortem?: () => void;
}

const PRIORITY_OPTIONS: Array<{ id: DispatchPriority; label: string }> = [
  { id: 'BALANCED', label: 'Balanced' },
  { id: 'MINIMIZE_STRANDED', label: 'Save Most Pax' },
  { id: 'ZERO_CANCELLATIONS', label: 'Zero Cancels' },
  { id: 'MINIMIZE_DELAY', label: 'Cut Total Delay' },
  { id: 'LOW_RESOURCE', label: 'Low Resource' },
];

type AuditSectionKey = 'all' | 'baselineSummary' | 'candidatePlans' | 'costWeightsInr' | 'disruptions';

export const AIDispatcherPanel: React.FC<AIDispatcherPanelProps> = ({
  compact = false,
  dataset,
  baseline,
  result,
  candidatePlans,
  availableActions,
  activeActions,
  dispatchPriority,
  onChangePriority,
  aiResponse,
  aiLoading,
  aiError,
  onRequestRecommendations,
  onApplyPlan,
  onToggleAction,
  onClearActions,
  onAskDispatcher,
  onGenerateComms,
  onExportPostMortem,
}) => {
  const [dispatcherTab, setDispatcherTab] = useState<'dispatch' | 'resilience'>('dispatch');
  const [showManualBuilder, setShowManualBuilder] = useState(!compact);
  const [showContextAudit, setShowContextAudit] = useState(false);
  const [auditSection, setAuditSection] = useState<AuditSectionKey>('all');
  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState<Array<{ q: string; a: string }>>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  // Custom "What-If" Action Builder State
  const [customType, setCustomType] = useState<RecoveryActionType>('DEPLOY_SPARE');
  const [customFlightId, setCustomFlightId] = useState<string>('');
  const [customSpareId, setCustomSpareId] = useState<string>(dataset.spares[0]?.id ?? '');
  const [customCrewId, setCustomCrewId] = useState<string>(dataset.standbyCrews[0]?.id ?? '');
  const [customHoldMin, setCustomHoldMin] = useState<number>(20);

  const [comms, setComms] = useState<AICommsResponse | null>(null);
  const [commsTab, setCommsTab] = useState<'passenger' | 'crew' | 'sitrep'>('passenger');
  const [commsLoading, setCommsLoading] = useState(false);
  const [commsError, setCommsError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const voice = useVoiceBriefing();

  // Sort flights for the manual What-If dropdown: cancelled & heavily delayed flights first
  const sortedFlightsForBuilder = useMemo(() => {
    return [...result.flights].sort((a, b) => {
      const scoreA = a.status === 'CANCELLED' ? 10000 : a.arrDelayMin;
      const scoreB = b.status === 'CANCELLED' ? 10000 : b.arrDelayMin;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.flight.schedDep - b.flight.schedDep;
    });
  }, [result.flights]);

  useEffect(() => {
    if (!customFlightId || !result.flightsById[customFlightId]) {
      setCustomFlightId(sortedFlightsForBuilder[0]?.flight.id ?? dataset.flights[0]?.id ?? '');
    }
  }, [sortedFlightsForBuilder, customFlightId, result.flightsById, dataset.flights]);

  useEffect(() => {
    if (dataset.spares.length > 0 && !dataset.spares.some((s) => s.id === customSpareId)) {
      setCustomSpareId(dataset.spares[0].id);
    }
    if (dataset.standbyCrews.length > 0 && !dataset.standbyCrews.some((c) => c.id === customCrewId)) {
      setCustomCrewId(dataset.standbyCrews[0].id);
    }
  }, [dataset.spares, dataset.standbyCrews, customSpareId, customCrewId]);

  // Clear comms when disruption or applied actions change so comms stay 100% synced with live deterministic state
  useEffect(() => {
    setComms(null);
    setCommsError(null);
    voice.stop();
  }, [baseline.disruption, baseline.secondaryDisruption, activeActions.length]);

  const planById = useMemo(() => new Map(candidatePlans.map((p) => [p.planId, p])), [candidatePlans]);

  // Deterministic JSON context passed to the AI Dispatcher — exposed transparently for Number-Audit verification
  const groundingContext = useMemo(() => {
    return {
      disruptions: baseline.disruptions.map((d) => ({
        airportCode: d.airportCode,
        window: `${formatTime(d.startMin)}-${formatTime(d.endMin)}`,
        durationMinutes: d.endMin - d.startMin,
        reason: d.reason,
      })),
      costWeightsInr: COST_WEIGHTS_INR,
      baselineSummary: {
        delayedFlights: baseline.summary.delayedFlights,
        cancelledFlights: baseline.summary.cancelledFlights,
        fdtlCancelledFlights: baseline.summary.fdtlCancelledFlights,
        totalDelayMinutes: baseline.summary.totalDelayMinutes,
        strandedPassengers: baseline.summary.strandedPassengers,
        strandedFromCancellations: baseline.summary.strandedFromCancellations,
        strandedFromMissedConnections: baseline.summary.strandedFromMissedConnections,
        crewBreachesCount: baseline.summary.crewBreachesCount,
        affectedAirportsCount: baseline.summary.affectedAirportsCount,
        estimatedCostInr: baseline.summary.estimatedCostInr,
        costBreakdown: baseline.summary.costBreakdown,
      },
      candidatePlans: candidatePlans.slice(0, 6).map((p) => ({
        planId: p.planId,
        title: p.title,
        category: p.category,
        actions: p.actions.map((a) => ({ id: a.id, type: a.type, label: a.label })),
        after: {
          strandedPassengers: p.after.strandedPassengers,
          cancelledFlights: p.after.cancelledFlights,
          totalDelayMinutes: p.after.totalDelayMinutes,
          crewBreachesCount: p.after.crewBreachesCount,
          estimatedCostInr: p.after.estimatedCostInr,
        },
        deltas: p.deltas,
      })),
    };
  }, [baseline, candidatePlans]);

  // Extract all exact deterministic numbers present in the engine context for Number-Audit badge verification
  const numberAuditReport = useMemo(() => {
    const knownNumbers = new Set<number>();
    const collectNums = (val: unknown) => {
      if (typeof val === 'number' && Number.isFinite(val)) {
        knownNumbers.add(Math.abs(val));
        knownNumbers.add(Math.round(Math.abs(val)));
        // Also register Lakh / Crore representations so formatted INR figures audit cleanly
        if (Math.abs(val) >= 100000) {
          knownNumbers.add(Number((Math.abs(val) / 100000).toFixed(1)));
          knownNumbers.add(Number((Math.abs(val) / 100000).toFixed(2)));
          knownNumbers.add(Math.round(Math.abs(val) / 100000));
        }
        if (Math.abs(val) >= 10000000) {
          knownNumbers.add(Number((Math.abs(val) / 10000000).toFixed(2)));
          knownNumbers.add(Number((Math.abs(val) / 10000000).toFixed(1)));
        }
      } else if (Array.isArray(val)) {
        val.forEach(collectNums);
      } else if (val && typeof val === 'object') {
        Object.values(val).forEach(collectNums);
      }
    };
    collectNums(groundingContext);
    // Also add flight-level metrics from baseline so flight-specific numbers verify
    for (const sf of baseline.flights) {
      knownNumbers.add(sf.arrDelayMin);
      knownNumbers.add(sf.depDelayMin);
      knownNumbers.add(sf.flight.passengers);
      knownNumbers.add(sf.cancelledLocalPax);
    }

    const auditedItems: Array<{ label: string; value: string; fieldPath: string; section: AuditSectionKey }> = [
      {
        label: 'Baseline Stranded Pax',
        value: baseline.summary.strandedPassengers.toLocaleString(),
        fieldPath: 'baselineSummary.strandedPassengers',
        section: 'baselineSummary',
      },
      {
        label: 'Baseline Cancelled',
        value: String(baseline.summary.cancelledFlights),
        fieldPath: 'baselineSummary.cancelledFlights',
        section: 'baselineSummary',
      },
      {
        label: 'Baseline Delay',
        value: `${baseline.summary.totalDelayMinutes.toLocaleString()}m`,
        fieldPath: 'baselineSummary.totalDelayMinutes',
        section: 'baselineSummary',
      },
      {
        label: 'Baseline Est. Cost',
        value: formatInrCompact(baseline.summary.estimatedCostInr),
        fieldPath: 'baselineSummary.estimatedCostInr',
        section: 'baselineSummary',
      },
    ];

    if (candidatePlans[0]) {
      auditedItems.push({
        label: 'Top Plan Cost Saved',
        value: formatInrDelta(candidatePlans[0].deltas.estimatedCostInr),
        fieldPath: 'candidatePlans[0].deltas.estimatedCostInr',
        section: 'candidatePlans',
      });
    }

    let citedCount = 0;
    let verifiedCount = 0;
    if (aiResponse) {
      const combinedText = [
        aiResponse.executiveBriefing,
        aiResponse.dominoMechanism,
        aiResponse.tradeOffComparison ?? '',
        ...aiResponse.recommendations.map((r) => `${r.rationale} ${r.tradeOff}`),
      ].join(' ');
      const matches = combinedText.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? [];
      for (const raw of matches) {
        const num = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(num) || num <= 3) continue; // skip small ordinal numbers 1, 2, 3
        citedCount += 1;
        if (knownNumbers.has(num) || knownNumbers.has(Math.round(num))) {
          verifiedCount += 1;
        }
      }
    }

    return {
      auditedItems,
      citedCount,
      verifiedCount,
    };
  }, [groundingContext, baseline.flights, baseline.summary, candidatePlans, aiResponse]);

  const openAuditSection = (section: AuditSectionKey) => {
    setAuditSection(section);
    setShowContextAudit(true);
  };

  const isPlanActive = (plan: CandidatePlanEvaluation) => {
    if (activeActions.length !== plan.actions.length) return false;
    const activeIds = new Set(activeActions.map((a) => a.id));
    return plan.actions.every((a) => activeIds.has(a.id));
  };

  const handleAddCustomAction = () => {
    const sf = result.flightsById[customFlightId];
    if (!sf) return;

    let action: RecoveryAction | null = null;
    if (customType === 'CANCEL_FLIGHT') {
      action = {
        id: `custom_cancel_${sf.flight.id}`,
        type: 'CANCEL_FLIGHT',
        flightId: sf.flight.id,
        label: `Cancel ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest})`,
        detail: `Manually cancel ${sf.flight.id} (${sf.flight.passengers} pax) to release ${sf.effectiveAircraftId} & ${sf.effectiveCrewId} for downstream legs.`,
      };
    } else if (customType === 'DEPLOY_SPARE') {
      const spare = dataset.spares.find((s) => s.id === customSpareId);
      if (!spare) return;
      action = {
        id: `custom_spare_${spare.id}_${sf.flight.id}`,
        type: 'DEPLOY_SPARE',
        flightId: sf.flight.id,
        spareId: spare.id,
        label: `Deploy ${spare.id} (${spare.baseAirport}) → ${sf.flight.id}`,
        detail: `Swap spare aircraft ${spare.id} stationed at ${spare.baseAirport} onto ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest}).`,
      };
    } else if (customType === 'SWAP_CREW') {
      const crew = dataset.standbyCrews.find((c) => c.id === customCrewId);
      if (!crew) return;
      action = {
        id: `custom_crew_${crew.id}_${sf.flight.id}`,
        type: 'SWAP_CREW',
        flightId: sf.flight.id,
        standbyCrewId: crew.id,
        label: `Assign ${crew.id} (${crew.baseAirport}) → ${sf.flight.id}`,
        detail: `Replace fatigued crew on ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest}) with fresh standby ${crew.name} (${crew.maxDutyMinutes / 60}h FDTL).`,
      };
    } else if (customType === 'HOLD_CONNECTION') {
      action = {
        id: `custom_hold_${sf.flight.id}_${customHoldMin}`,
        type: 'HOLD_CONNECTION',
        flightId: sf.flight.id,
        holdMinutes: customHoldMin,
        label: `Hold ${sf.flight.id} (+${customHoldMin}m)`,
        detail: `Hold outbound ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest}) by ${customHoldMin} minutes to protect inbound passenger connections.`,
      };
    }

    if (action) {
      onToggleAction(action);
    }
  };

  const handleAsk = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed || qaLoading) return;
    setQaLoading(true);
    setQaError(null);
    setQuestion('');
    try {
      const answer = await onAskDispatcher(trimmed);
      setQaHistory((prev) => [{ q: trimmed, a: answer }, ...prev]);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : 'Unable to reach AI Dispatcher.');
    } finally {
      setQaLoading(false);
    }
  };

  const handleGenerateComms = async () => {
    if (commsLoading) return;
    setCommsLoading(true);
    setCommsError(null);
    try {
      const generated = await onGenerateComms();
      setComms(generated);
    } catch (err) {
      setCommsError(err instanceof Error ? err.message : 'Failed to generate operational communications.');
    } finally {
      setCommsLoading(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard error
    }
  };

  const quickQuestions = (() => {
    const firstCancel = baseline.flights.find((f) => f.status === 'CANCELLED');
    return [
      firstCancel
        ? `Why was ${firstCancel.flight.id} (${firstCancel.flight.origin}→${firstCancel.flight.dest}) cancelled?`
        : `Which aircraft chain suffered the worst delay?`,
      `Which hub has the most stranded passengers right now?`,
      `Compare deploying a spare aircraft versus swapping a standby crew.`,
    ];
  })();

  // Benchmark current stacked manual sandbox vs #1 AI / Engine recommended plan
  const bestBenchmarkPlan = useMemo(() => {
    if (aiResponse && aiResponse.recommendations[0]) {
      const p = planById.get(aiResponse.recommendations[0].planId);
      if (p) return p;
    }
    return candidatePlans[0] ?? null;
  }, [aiResponse, planById, candidatePlans]);

  const displayedPlans = useMemo(() => {
    if (aiResponse) {
      return aiResponse.recommendations
        .map((rec) => ({ rec, plan: planById.get(rec.planId) }))
        .filter((x): x is { rec: typeof x.rec; plan: CandidatePlanEvaluation } => Boolean(x.plan));
    }
    return candidatePlans.slice(0, compact ? 4 : 3).map((plan) => ({ rec: null, plan }));
  }, [aiResponse, planById, candidatePlans, compact]);

  const costDeltaInr = result.summary.estimatedCostInr - baseline.summary.estimatedCostInr;

  const tabSwitcher = (
    <div
      className={
        compact
          ? 'px-4 py-2.5 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between gap-2'
          : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl px-4 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.14)] flex flex-wrap items-center justify-between gap-3'
      }
    >
      <div className="flex items-center gap-1 p-1 bg-slate-200/75 rounded-lg" role="tablist" aria-label="AI Dispatcher sections">
        <button
          type="button"
          role="tab"
          aria-selected={dispatcherTab === 'dispatch'}
          onClick={() => setDispatcherTab('dispatch')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            dispatcherTab === 'dispatch'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Recovery Dispatch
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={dispatcherTab === 'resilience'}
          onClick={() => setDispatcherTab('resilience')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            dispatcherTab === 'resilience'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Network Resilience Report
        </button>
      </div>
      {!compact && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
            {dataset.airports.length} airports · {dataset.flights.length} flights
          </span>
          {onExportPostMortem && (
            <button
              type="button"
              onClick={onExportPostMortem}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-blue-700" />
              Export Post-Mortem Brief
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (dispatcherTab === 'resilience') {
    return (
      <div className={`flex flex-col ${compact ? 'h-full overflow-y-auto' : 'space-y-5'}`}>
        {tabSwitcher}
        <NetworkResilienceReport
          compact={compact}
          dataset={dataset}
          baseline={baseline}
          result={result}
        />
      </div>
    );
  }

  if (!baseline.disruption) {
    return (
      <div className={`flex flex-col ${compact ? 'h-full overflow-y-auto' : 'space-y-5'}`}>
        {tabSwitcher}
        <div
          className={
            compact
              ? 'p-6 text-sm text-slate-600'
              : 'p-6 text-sm text-slate-600 bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.14)]'
          }
        >
          <div className="font-semibold text-slate-900">No Disruption Active</div>
          <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
            Close any airport above—or type a natural-language scenario in the AI Scenario bar—to trigger a delay cascade and generate AI Dispatcher recovery plans, voice briefings, and passenger/crew advisories. You can also open the Network Resilience Report tab above to inspect structural sensitivity across all {dataset.airports.length} airports.
          </p>
        </div>
      </div>
    );
  }

  const displayedAuditJson =
    auditSection === 'all'
      ? groundingContext
      : { [auditSection]: groundingContext[auditSection] };

  return (
    <div className={`flex flex-col ${compact ? 'h-full overflow-y-auto divide-y divide-slate-200' : 'space-y-6'}`}>
      {tabSwitcher}

      {/* Header, Priority Objective, Number-Audit Toggle & Action Trigger */}
      <div className={compact ? 'p-4 bg-slate-50/70' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">AI Operations Dispatcher</h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Evaluates {candidatePlans.length} deterministically simulated recovery plans for{' '}
              {baseline.disruptions
                .map((d) => `${d.airportCode} (${formatTime(d.startMin)}–${formatTime(d.endMin)})`)
                .join(' + ')}{' '}
              so every cited figure matches the engine.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowContextAudit((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                showContextAudit
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
              title="Inspect exact deterministic engine JSON sent to the AI Dispatcher"
            >
              <Code2 className="w-3.5 h-3.5 text-emerald-700" />
              Inspect AI Context JSON
            </button>
            {compact && onExportPostMortem && (
              <button
                type="button"
                onClick={onExportPostMortem}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-blue-700" />
                Post-Mortem
              </button>
            )}
            {activeActions.length > 0 && (
              <button
                type="button"
                onClick={onClearActions}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Revert
              </button>
            )}
            <button
              type="button"
              onClick={() => onRequestRecommendations()}
              disabled={aiLoading || candidatePlans.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiLoading ? 'Analyzing Cascade...' : aiResponse ? 'Refresh Briefing' : 'Generate AI Briefing'}
            </button>
          </div>
        </div>

        {/* Number-Audit / Grounding Inspector Drawer */}
        {showContextAudit && (
          <div className="mt-3.5 rounded-xl border border-emerald-200 bg-slate-950 text-slate-100 overflow-hidden">
            <div className="px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-semibold text-white">Deterministic Grounding Inspector</span>
                <span className="text-[11px] font-mono text-emerald-300">
                  Zero-Hallucination Audit
                  {aiResponse && numberAuditReport.citedCount > 0
                    ? ` · ${numberAuditReport.verifiedCount}/${numberAuditReport.citedCount} cited figures verified`
                    : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy('audit-json', JSON.stringify(displayedAuditJson, null, 2))}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer"
                >
                  {copiedKey === 'audit-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === 'audit-json' ? 'Copied JSON' : 'Copy JSON'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowContextAudit(false)}
                  aria-label="Close grounding inspector"
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Verified Deterministic Anchors Bar */}
            <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800 flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'Full Payload' },
                  { id: 'baselineSummary', label: 'baselineSummary' },
                  { id: 'candidatePlans', label: 'candidatePlans' },
                  { id: 'costWeightsInr', label: 'costWeightsInr' },
                  { id: 'disruptions', label: 'disruptions' },
                ] as const
              ).map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setAuditSection(sec.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                    auditSection === sec.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {sec.label}
                </button>
              ))}
            </div>

            <div className="px-3.5 py-2 bg-slate-900/40 border-b border-slate-800 flex flex-wrap gap-3 text-[11px] font-mono tabular-nums">
              {numberAuditReport.auditedItems.map((item) => (
                <button
                  key={item.fieldPath}
                  type="button"
                  onClick={() => setAuditSection(item.section)}
                  className="text-left hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  <span className="text-slate-400">{item.label}: </span>
                  <span className="text-emerald-300 font-semibold">{item.value}</span>
                </button>
              ))}
            </div>

            <pre className="p-3.5 text-[11px] font-mono leading-relaxed text-sky-100 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(displayedAuditJson, null, 2)}
            </pre>
          </div>
        )}

        {/* Dispatch Priority Goal Selector */}
        <div className="mt-3 pt-3 border-t border-slate-200/80 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">Priority Goal:</span>
          <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChangePriority(opt.id);
                  if (aiResponse && !aiLoading) {
                    onRequestRecommendations(opt.id);
                  }
                }}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  dispatchPriority === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Active Recovery Before -> After Diff Banner (with Financial Cost Saved & Stacked Chips) */}
        {activeActions.length > 0 && (
          <div className="mt-3.5 pt-3.5 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Recovery Comparison (Before → After)
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {activeActions.length} {activeActions.length === 1 ? 'action' : 'actions'} stacked
              </span>
            </div>

            {/* Stacked Actions Chips (removable one-by-one) */}
            <div className="flex flex-wrap gap-1.5">
              {activeActions.map((act, idx) => (
                <span
                  key={act.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-950 text-[11px] font-medium"
                >
                  <span className="font-mono text-blue-700 font-semibold">#{idx + 1}</span>
                  <span>{act.label}</span>
                  <button
                    type="button"
                    onClick={() => onToggleAction(act)}
                    aria-label={`Remove ${act.label}`}
                    className="text-blue-600 hover:text-rose-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <div className="text-slate-500 text-[11px]">Stranded Pax</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {baseline.summary.strandedPassengers} → {result.summary.strandedPassengers}{' '}
                  <span className={result.summary.strandedPassengers <= baseline.summary.strandedPassengers ? 'text-emerald-700' : 'text-rose-600'}>
                    ({formatDelta(result.summary.strandedPassengers - baseline.summary.strandedPassengers)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Cancelled Flights</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {baseline.summary.cancelledFlights} → {result.summary.cancelledFlights}{' '}
                  <span className={result.summary.cancelledFlights <= baseline.summary.cancelledFlights ? 'text-emerald-700' : 'text-rose-600'}>
                    ({formatDelta(result.summary.cancelledFlights - baseline.summary.cancelledFlights)})
                  </span>
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Total Delay</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {baseline.summary.totalDelayMinutes}m → {result.summary.totalDelayMinutes}m
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Crew Breaches</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {baseline.summary.crewBreachesCount} → {result.summary.crewBreachesCount}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-[11px]">Disruption Cost</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                  {formatInrCompact(result.summary.estimatedCostInr)}{' '}
                  <span className={costDeltaInr <= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                    ({formatInrDelta(costDeltaInr)})
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {aiError && (
          <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <div>
              <span className="font-semibold">AI Dispatcher Error:</span> {aiError}
            </div>
          </div>
        )}
      </div>

      {/* AI Executive Briefing & Voice Playback */}
      {aiResponse && (
        <div className={compact ? 'p-4 space-y-2.5' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 space-y-3 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs font-semibold text-slate-900">Executive Cascade Briefing</div>
                <button
                  type="button"
                  onClick={() => openAuditSection('baselineSummary')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Grounded in Engine JSON</span>
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-700 leading-relaxed">{aiResponse.executiveBriefing}</p>
            </div>
            <button
              type="button"
              onClick={() =>
                voice.speak(
                  'exec-briefing',
                  `${aiResponse.executiveBriefing} ${aiResponse.dominoMechanism}`,
                  'Calm, authoritative airline operations control center dispatcher delivering a shift briefing'
                )
              }
              disabled={voice.loadingKey === 'exec-briefing'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              {voice.loadingKey === 'exec-briefing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : voice.playingKey === 'exec-briefing' ? (
                <Square className="w-3.5 h-3.5 text-rose-600" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-blue-700" />
              )}
              {voice.loadingKey === 'exec-briefing'
                ? 'Synthesizing...'
                : voice.playingKey === 'exec-briefing'
                ? 'Stop Audio'
                : 'Listen to Briefing'}
            </button>
          </div>
          <div className="pt-2.5 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-900">How the Domino Spread</div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">{aiResponse.dominoMechanism}</p>
          </div>
          {voice.voiceError && <p className="text-[11px] text-rose-600">{voice.voiceError}</p>}
        </div>
      )}

      {/* Airport Delay Distribution Bar Chart (Baseline vs Current Recovery Plan) */}
      <AirportDelayChart
        compact={compact}
        airports={dataset.airports}
        baseline={baseline}
        result={result}
        hasRecovery={activeActions.length > 0}
      />

      {/* Recommended Plans (Bound strictly to deterministic evaluations) */}
      <div className={compact ? 'p-4 space-y-3' : 'space-y-3'}>
        <div className="flex items-center justify-between">
          <h3
            className={`text-xs font-semibold ${
              compact
                ? 'text-slate-900'
                : 'text-white drop-shadow-[0_1px_2px_rgba(15,23,42,0.75)]'
            }`}
          >
            {aiResponse
              ? `AI-Recommended Recovery Plans (${aiResponse.recommendations.length})`
              : `Deterministic Candidate Recovery Plans (${Math.min(compact ? 4 : 3, candidatePlans.length)})`}
          </h3>
          {!aiResponse && !aiLoading && candidatePlans.length > 0 && (
            <span
              className={`text-[11px] ${
                compact
                  ? 'text-slate-500'
                  : 'text-slate-100 drop-shadow-[0_1px_2px_rgba(15,23,42,0.75)]'
              }`}
            >
              Click Generate AI Briefing for rationale & trade-off analysis
            </span>
          )}
        </div>

        <div className={compact ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-3 gap-4'}>
          {displayedPlans.map((item, index) => {
            const { rec, plan } = item;
            const active = isPlanActive(plan);

            return (
              <div
                key={plan.planId}
                className={`bg-white/90 backdrop-blur-xl border rounded-xl p-4 flex flex-col justify-between transition-colors shadow-[0_8px_28px_rgba(15,23,42,0.14)] ${
                  active ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-white/70'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-blue-700">
                      {rec ? `${rec.rank}. ${rec.badge}` : `Option ${index + 1} · ${plan.category.replace('_', ' ')}`}
                    </span>
                    <span className="font-mono tabular-nums">
                      {plan.actions.length} {plan.actions.length === 1 ? 'action' : 'actions'}
                    </span>
                  </div>

                  <h4 className="mt-1.5 text-sm font-semibold text-slate-900 leading-snug">
                    {rec ? rec.headline : plan.title}
                  </h4>

                  {rec && <p className="mt-2 text-xs text-slate-600 leading-relaxed">{rec.rationale}</p>}

                  {/* Deterministic Exact Before -> After Matrix + Financial Savings */}
                  <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Stranded Pax</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
                        {plan.before.strandedPassengers} → {plan.after.strandedPassengers}
                        <span
                          className={`ml-1 ${
                            plan.deltas.strandedPassengers < 0 ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          ({formatDelta(plan.deltas.strandedPassengers)})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Cancelled Flights</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
                        {plan.before.cancelledFlights} → {plan.after.cancelledFlights}
                        <span
                          className={`ml-1 ${
                            plan.deltas.cancelledFlights < 0 ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          ({formatDelta(plan.deltas.cancelledFlights)})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Total Delay</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
                        {plan.before.totalDelayMinutes}m → {plan.after.totalDelayMinutes}m
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Est. Cost Impact</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatInrCompact(plan.after.estimatedCostInr)}
                        <span
                          className={`ml-1 ${
                            plan.deltas.estimatedCostInr < 0 ? 'text-emerald-700' : 'text-rose-600'
                          }`}
                        >
                          ({formatInrDelta(plan.deltas.estimatedCostInr)})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Operational Steps / Actions */}
                  <ul className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                    {(rec ? rec.operationalSteps : plan.actions.map((a) => a.detail)).map((step, sIdx) => (
                      <li key={sIdx} className="flex gap-1.5 leading-snug">
                        <ArrowRight className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>

                  {rec && (
                    <div className="mt-2.5 text-[11px] text-slate-500 leading-snug">
                      <span className="font-medium text-slate-700">Trade-off:</span> {rec.tradeOff}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (active ? onClearActions() : onApplyPlan(plan.actions))}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {active ? 'Plan Applied (Revert)' : 'Apply Recovery Plan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openAuditSection('candidatePlans')}
                    title="Verify plan numbers in deterministic JSON"
                    className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-700 hover:border-emerald-300 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trade-Off Comparison Matrix (Why Option A Beats Option B) */}
      {displayedPlans.length >= 2 && (
        <div className={compact ? 'p-4 space-y-3' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 space-y-3.5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-blue-700 shrink-0" />
              <div>
                <h3 className="text-xs font-semibold text-slate-900">Trade-Off Comparison Matrix</h3>
                <p className="text-[11px] text-slate-500">
                  Head-to-head operational and financial comparison across top candidate plans.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openAuditSection('costWeightsInr')}
              className="text-[11px] font-medium text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Cost Weights: ₹8.5k/pax · ₹2.5L/cxl · ₹1.2k/min
            </button>
          </div>

          {aiResponse?.tradeOffComparison && (
            <div className="rounded-lg bg-blue-50/70 border border-blue-200/80 px-3.5 py-2.5 text-xs text-slate-800 leading-relaxed">
              <span className="font-semibold text-blue-950">Why Option #1 Wins: </span>
              {aiResponse.tradeOffComparison}
            </div>
          )}

          <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 font-semibold">Option</th>
                  <th className="py-2 px-3 font-semibold">Stranded Pax</th>
                  <th className="py-2 px-3 font-semibold">Cancelled</th>
                  <th className="py-2 px-3 font-semibold">Delay Min</th>
                  <th className="py-2 px-3 font-semibold">Crew Breaches</th>
                  <th className="py-2 px-3 font-semibold">Net Cost Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {displayedPlans.slice(0, 3).map(({ rec, plan }, idx) => (
                  <tr key={plan.planId} className={idx === 0 ? 'bg-emerald-50/35' : ''}>
                    <td className="py-2 px-3 font-sans">
                      <div className="font-semibold text-slate-900">
                        #{idx + 1} {rec ? rec.badge : plan.category.replace('_', ' ')}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
                        {plan.actions.map((a) => a.label).join(' + ')}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-900">
                      {plan.after.strandedPassengers}{' '}
                      <span className={plan.deltas.strandedPassengers <= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                        ({formatDelta(plan.deltas.strandedPassengers)})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-900">
                      {plan.after.cancelledFlights}{' '}
                      <span className={plan.deltas.cancelledFlights <= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                        ({formatDelta(plan.deltas.cancelledFlights)})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-900">
                      {plan.after.totalDelayMinutes}m{' '}
                      <span className={plan.deltas.totalDelayMinutes <= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                        ({formatDelta(plan.deltas.totalDelayMinutes, 'm')})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-900">{plan.after.crewBreachesCount}</td>
                    <td className="py-2 px-3 font-semibold">
                      <span className={plan.deltas.estimatedCostInr <= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                        {formatInrDelta(plan.deltas.estimatedCostInr)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Multi-Action Recovery Sandbox & "What-If" Custom Action Builder */}
      <div className={compact ? 'p-4' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
        <button
          type="button"
          onClick={() => setShowManualBuilder((v) => !v)}
          className="w-full flex items-center justify-between text-xs font-semibold text-slate-900 cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-700" />
            Multi-Action Recovery Sandbox &amp; What-If Builder ({activeActions.length} stacked)
          </span>
          <span className="text-blue-700 font-medium">{showManualBuilder ? 'Hide' : 'Expand'}</span>
        </button>

        {showManualBuilder && (
          <div className="mt-3.5 space-y-3.5">
            {/* Live "Beat the AI?" Benchmark Banner */}
            {activeActions.length > 0 && bestBenchmarkPlan && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Trophy
                    className={`w-4 h-4 shrink-0 ${
                      result.summary.estimatedCostInr < bestBenchmarkPlan.after.estimatedCostInr
                        ? 'text-emerald-600'
                        : result.summary.estimatedCostInr === bestBenchmarkPlan.after.estimatedCostInr
                        ? 'text-blue-600'
                        : 'text-amber-600'
                    }`}
                  />
                  <div>
                    <span className="font-semibold text-slate-900">
                      {result.summary.estimatedCostInr < bestBenchmarkPlan.after.estimatedCostInr
                        ? 'Your Custom Stack Beats AI Option #1!'
                        : result.summary.estimatedCostInr === bestBenchmarkPlan.after.estimatedCostInr
                        ? 'Your Stack Matches AI Option #1'
                        : 'AI Option #1 Currently Leads Your Stack'}
                    </span>
                    <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
                      Your Stack: {result.summary.strandedPassengers} pax · {formatInrCompact(result.summary.estimatedCostInr)} vs AI #1:{' '}
                      {bestBenchmarkPlan.after.strandedPassengers} pax · {formatInrCompact(bestBenchmarkPlan.after.estimatedCostInr)}
                    </div>
                  </div>
                </div>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    result.summary.estimatedCostInr <= bestBenchmarkPlan.after.estimatedCostInr
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {formatInrDelta(result.summary.estimatedCostInr - bestBenchmarkPlan.after.estimatedCostInr)} vs AI #1
                </span>
              </div>
            )}

            {/* Manual Dropdown "What-If" Action Composer */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
              <div className="text-[11px] font-semibold text-slate-700">
                Build &amp; Stack Custom Action (Recalculates All {dataset.flights.length} Flights Deterministically)
              </div>
              <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-4'}`}>
                <select
                  aria-label="Custom action type"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value as RecoveryActionType)}
                  className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="DEPLOY_SPARE">Deploy Spare Aircraft</option>
                  <option value="SWAP_CREW">Swap Standby Crew</option>
                  <option value="HOLD_CONNECTION">Hold Outbound Flight</option>
                  <option value="CANCEL_FLIGHT">Cancel Flight</option>
                </select>

                <select
                  aria-label="Target flight"
                  value={customFlightId}
                  onChange={(e) => setCustomFlightId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {sortedFlightsForBuilder.map((sf) => (
                    <option key={sf.flight.id} value={sf.flight.id}>
                      {sf.flight.id} {sf.flight.origin}→{sf.flight.dest} (
                      {sf.status === 'CANCELLED' ? 'CXL' : sf.arrDelayMin > 0 ? `+${sf.arrDelayMin}m` : 'On Time'})
                    </option>
                  ))}
                </select>

                {customType === 'DEPLOY_SPARE' && (
                  <select
                    aria-label="Spare aircraft"
                    value={customSpareId}
                    onChange={(e) => setCustomSpareId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {dataset.spares.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.id} @ {sp.baseAirport}
                      </option>
                    ))}
                  </select>
                )}

                {customType === 'SWAP_CREW' && (
                  <select
                    aria-label="Standby crew"
                    value={customCrewId}
                    onChange={(e) => setCustomCrewId(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {dataset.standbyCrews.map((cr) => (
                      <option key={cr.id} value={cr.id}>
                        {cr.id} @ {cr.baseAirport} ({cr.maxDutyMinutes / 60}h)
                      </option>
                    ))}
                  </select>
                )}

                {customType === 'HOLD_CONNECTION' && (
                  <select
                    aria-label="Hold duration minutes"
                    value={customHoldMin}
                    onChange={(e) => setCustomHoldMin(Number(e.target.value))}
                    className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {[10, 15, 20, 25, 30, 45].map((m) => (
                      <option key={m} value={m}>
                        Hold +{m} min
                      </option>
                    ))}
                  </select>
                )}

                {customType === 'CANCEL_FLIGHT' && (
                  <div className="px-2.5 py-1.5 text-[11px] text-slate-500 flex items-center">
                    Releases aircraft &amp; crew
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddCustomAction}
                  disabled={!customFlightId}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Stack Action
                </button>
              </div>
            </div>

            {/* Quick-Add High-Impact Engine Levers */}
            <div>
              <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                Quick-Stack Engine Levers ({availableActions.length} targeted options):
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {availableActions.map((act) => {
                  const active = activeActions.some((a) => a.id === act.id);
                  return (
                    <button
                      key={act.id}
                      type="button"
                      onClick={() => onToggleAction(act)}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-50 border-blue-400 text-blue-950'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{act.label}</span>
                        <span className={`text-[11px] font-semibold shrink-0 ${active ? 'text-blue-700' : 'text-slate-400'}`}>
                          {active ? 'Stacked ✓' : '+ Stack'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{act.detail}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Operational Communications Studio (Passenger PA/SMS, Crew Directive, Executive SitRep) */}
      <div className={compact ? 'p-4' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <Megaphone className="w-3.5 h-3.5 text-blue-700" />
              AI Dispatch Communications &amp; Voice PA
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Draft grounded passenger advisories, crew directives, and leadership SitReps matching the current {activeActions.length > 0 ? 'recovered' : 'disrupted'} schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateComms}
            disabled={commsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-900 text-xs font-medium whitespace-nowrap cursor-pointer"
          >
            {commsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-blue-700" />}
            {commsLoading ? 'Drafting Comms...' : comms ? 'Redraft Comms' : 'Draft Comms'}
          </button>
        </div>

        {commsError && <div className="mt-2.5 text-xs text-rose-600">{commsError}</div>}

        {comms && (
          <div className="mt-3.5 space-y-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
              {(
                [
                  { id: 'passenger', label: 'Passenger SMS & PA' },
                  { id: 'crew', label: 'Crew Directive' },
                  { id: 'sitrep', label: 'OCC SitRep' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCommsTab(t.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    commsTab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {commsTab === 'passenger' && (
              <div className="space-y-3 text-xs border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
                <div className="font-semibold text-slate-900">{comms.passengerAdvisory.subject}</div>
                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span className="font-medium text-slate-700">Passenger SMS Advisory</span>
                    <button
                      type="button"
                      onClick={() => handleCopy('sms', comms.passengerAdvisory.smsText)}
                      className="flex items-center gap-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      {copiedKey === 'sms' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copiedKey === 'sms' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-slate-700 leading-relaxed">{comms.passengerAdvisory.smsText}</p>
                </div>
                <div className="pt-2.5 border-t border-slate-200">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span className="font-medium text-slate-700">Terminal Gate PA Script</span>
                    <button
                      type="button"
                      onClick={() =>
                        voice.speak(
                          'comms-pa',
                          comms.passengerAdvisory.gateAnnouncement,
                          'Warm, clear, reassuring airport terminal announcer'
                        )
                      }
                      disabled={voice.loadingKey === 'comms-pa'}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] cursor-pointer"
                    >
                      {voice.loadingKey === 'comms-pa' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : voice.playingKey === 'comms-pa' ? (
                        <Square className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                      {voice.playingKey === 'comms-pa' ? 'Stop PA' : 'Play Voice PA'}
                    </button>
                  </div>
                  <p className="text-slate-700 leading-relaxed">&ldquo;{comms.passengerAdvisory.gateAnnouncement}&rdquo;</p>
                </div>
              </div>
            )}

            {commsTab === 'crew' && (
              <div className="space-y-2 text-xs border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{comms.crewDirective.subject}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('crew', comms.crewDirective.directiveText)}
                    className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    {copiedKey === 'crew' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'crew' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-slate-700 leading-relaxed">{comms.crewDirective.directiveText}</p>
              </div>
            )}

            {commsTab === 'sitrep' && (
              <div className="space-y-2 text-xs border border-slate-200 rounded-lg p-3.5 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{comms.executiveSitrep.subject}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy('sitrep', comms.executiveSitrep.summaryText)}
                      className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      {copiedKey === 'sitrep' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copiedKey === 'sitrep' ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        voice.speak(
                          'comms-sitrep',
                          comms.executiveSitrep.summaryText,
                          'Crisp, authoritative airline operations executive briefing'
                        )
                      }
                      disabled={voice.loadingKey === 'comms-sitrep'}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] cursor-pointer"
                    >
                      {voice.loadingKey === 'comms-sitrep' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : voice.playingKey === 'comms-sitrep' ? (
                        <Square className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                      {voice.playingKey === 'comms-sitrep' ? 'Stop' : 'Speak'}
                    </button>
                  </div>
                </div>
                <p className="text-slate-700 leading-relaxed">{comms.executiveSitrep.summaryText}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ask the AI Dispatcher (Grounded Live Q&A) */}
      <div className={compact ? 'p-4' : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]'}>
        <div className="text-xs font-semibold text-slate-900">Ask the AI Dispatcher</div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Answers are strictly grounded in the live deterministic simulation state.
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {quickQuestions.map((qq) => (
            <button
              key={qq}
              type="button"
              onClick={() => handleAsk(qq)}
              disabled={qaLoading}
              className="text-left text-[11px] px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
            >
              {qq}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk(question);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about any flight, crew duty limit, or recovery trade-off..."
            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={qaLoading || !question.trim()}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            {qaLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Ask
          </button>
        </form>

        {qaError && <div className="mt-2 text-xs text-rose-600">{qaError}</div>}

        {qaHistory.length > 0 && (
          <div className="mt-3.5 space-y-3 divide-y divide-slate-100">
            {qaHistory.map((item, idx) => (
              <div key={idx} className={idx > 0 ? 'pt-3' : ''}>
                <div className="text-xs font-semibold text-slate-900">{item.q}</div>
                <p className="mt-1 text-xs text-slate-700 leading-relaxed whitespace-pre-line">{item.a}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
