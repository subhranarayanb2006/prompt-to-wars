import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  X,
  Sparkles,
  Volume2,
  Square,
  Loader2,
  Copy,
  Check,
  Star,
} from 'lucide-react';
import {
  AIFlightExplainResponse,
  NetworkDataset,
  RecoveryAction,
  SimulatedFlight,
  SimulationResult,
} from '../types/network';
import { formatDuration, formatTime } from '../utils/time';
import { useVoiceBriefing } from '../hooks/useVoiceBriefing';

interface CascadeInspectorProps {
  dataset: NetworkDataset;
  result: SimulationResult;
  baseline: SimulationResult;
  selectedFlightId: string | null;
  selectedAirportCode: string | null;
  availableActions: RecoveryAction[];
  activeActions: RecoveryAction[];
  watchlistIds: string[];
  onToggleWatchlist: (flightId: string) => void;
  onSelectFlight: (id: string | null) => void;
  onSelectAirport: (code: string | null) => void;
  onCloseAirportPreset: (code: string) => void;
  onToggleAction: (action: RecoveryAction) => void;
  onOpenAIDispatcher: () => void;
}

function getCauseText(sf: SimulatedFlight): { label: string; toneClass: string } {
  switch (sf.rootCause) {
    case 'CREW_FDTL_CANCELLED':
      return { label: 'Cancelled · Crew FDTL Limit', toneClass: 'text-rose-700 font-semibold' };
    case 'RECOVERY_CANCELLED':
      return { label: 'Cancelled · Recovery Plan', toneClass: 'text-slate-700 font-semibold' };
    case 'AIRPORT_CLOSURE_DEP':
      return { label: 'Direct Closure Hold (Dep)', toneClass: 'text-rose-700 font-medium' };
    case 'AIRPORT_CLOSURE_ARR':
      return { label: 'Direct Closure Hold (Arr)', toneClass: 'text-rose-700 font-medium' };
    case 'CREW_CASCADE':
      return { label: 'Crew Cascade (Cross-Aircraft)', toneClass: 'text-purple-700 font-medium' };
    case 'AIRCRAFT_CASCADE':
      return { label: 'Aircraft Turnaround Cascade', toneClass: 'text-amber-700 font-medium' };
    case 'CONNECTION_HOLD':
      return { label: 'Held for Connecting Pax', toneClass: 'text-blue-700 font-medium' };
    case 'RECOVERED_SPARE':
      return { label: 'Recovered · Spare Aircraft', toneClass: 'text-emerald-700 font-semibold' };
    case 'RECOVERED_CREW':
      return { label: 'Protected · Standby Crew', toneClass: 'text-emerald-700 font-semibold' };
    default:
      return { label: 'On Time', toneClass: 'text-emerald-700 font-medium' };
  }
}

export const CascadeInspector: React.FC<CascadeInspectorProps> = ({
  dataset,
  result,
  baseline,
  selectedFlightId,
  selectedAirportCode,
  availableActions,
  activeActions,
  watchlistIds,
  onToggleWatchlist,
  onSelectFlight,
  onSelectAirport,
  onCloseAirportPreset,
  onToggleAction,
  onOpenAIDispatcher,
}) => {
  const [flightBrief, setFlightBrief] = useState<AIFlightExplainResponse | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [copiedPa, setCopiedPa] = useState(false);
  const voice = useVoiceBriefing();

  // Clear cached AI brief when switching flights or when simulation changes
  useEffect(() => {
    setFlightBrief(null);
    setBriefError(null);
    voice.stop();
  }, [selectedFlightId, result.disruption, result.actions.length]);

  const selectedFlight = selectedFlightId ? result.flightsById[selectedFlightId] : null;
  const baselineSelectedFlight = selectedFlightId ? baseline.flightsById[selectedFlightId] : null;
  const selectedAirport = selectedAirportCode
    ? dataset.airports.find((a) => a.code === selectedAirportCode) ?? null
    : null;

  // === 1. FLIGHT DOMINO CAUSE CHAIN VIEW ===
  if (selectedFlight) {
    const cause = getCauseText(selectedFlight);
    const tailChain = result.flights.filter(
      (f) => f.flight.aircraftId === selectedFlight.flight.aircraftId
    );
    const relatedConnections = result.connections.filter(
      (c) =>
        c.connection.fromFlightId === selectedFlight.flight.id ||
        c.connection.toFlightId === selectedFlight.flight.id
    );
    const matchingActions = availableActions.filter(
      (a) => a.flightId === selectedFlight.flight.id || a.secondFlightId === selectedFlight.flight.id
    );

    const crewPct =
      selectedFlight.crewDutyAtArrivalMin !== null
        ? Math.min(130, Math.round((selectedFlight.crewDutyAtArrivalMin / selectedFlight.crewMaxDutyMin) * 100))
        : 0;

    const handleExplainFlight = async () => {
      if (briefLoading) return;
      setBriefLoading(true);
      setBriefError(null);
      try {
        const res = await fetch('/api/dispatcher/explain-flight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flightContext: {
              flightId: selectedFlight.flight.id,
              route: `${selectedFlight.flight.origin} to ${selectedFlight.flight.dest}`,
              scheduled: `${formatTime(selectedFlight.flight.schedDep)}-${formatTime(selectedFlight.flight.schedArr)}`,
              actual:
                selectedFlight.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : `${formatTime(selectedFlight.actualDep)}-${formatTime(selectedFlight.actualArr)}`,
              status: selectedFlight.status,
              delayMinutes: selectedFlight.arrDelayMin,
              aircraftId: selectedFlight.effectiveAircraftId,
              crewId: selectedFlight.effectiveCrewId,
              passengers: selectedFlight.flight.passengers,
              cancelledLocalPax: selectedFlight.cancelledLocalPax,
              brokenOutboundConnections: selectedFlight.brokenOutboundConnections,
              crewDutyMinutes: selectedFlight.crewDutyAtArrivalMin,
              crewMaxDutyMinutes: selectedFlight.crewMaxDutyMin,
              crewBreachMinutes: selectedFlight.crewBreachMin,
              causeSummary: selectedFlight.causeSummary,
              causeChain: selectedFlight.causeChain,
              disruption: result.disruption
                ? `${result.disruption.airportCode} closed ${formatTime(result.disruption.startMin)}-${formatTime(result.disruption.endMin)} (${result.disruption.reason})`
                : 'None',
              availableActions: matchingActions.map((a) => a.label),
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate AI flight brief.');
        setFlightBrief(data as AIFlightExplainResponse);
      } catch (err) {
        setBriefError(err instanceof Error ? err.message : 'Unable to reach AI Dispatcher.');
      } finally {
        setBriefLoading(false);
      }
    };

    const handleCopyGateNotice = async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedPa(true);
        window.setTimeout(() => setCopiedPa(false), 1800);
      } catch {
        // ignore clipboard failure
      }
    };

    return (
      <div className="flex flex-col h-full overflow-y-auto divide-y divide-slate-200">
        {/* Flight Header */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span className="font-semibold text-slate-900 text-base font-display">
                  {selectedFlight.flight.id}
                </span>
                <span>·</span>
                <span className="font-semibold text-slate-800">
                  {selectedFlight.flight.origin} → {selectedFlight.flight.dest}
                </span>
              </div>
              <div className={`mt-1 text-xs ${cause.toneClass}`}>{cause.label}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onToggleWatchlist(selectedFlight.flight.id)}
                className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label={
                  watchlistIds.includes(selectedFlight.flight.id)
                    ? `Remove ${selectedFlight.flight.id} from Watchlist`
                    : `Add ${selectedFlight.flight.id} to Watchlist`
                }
                title={
                  watchlistIds.includes(selectedFlight.flight.id)
                    ? 'Starred in Watchlist (click to remove)'
                    : 'Star to add to Watchlist'
                }
              >
                <Star
                  className={`w-4 h-4 ${
                    watchlistIds.includes(selectedFlight.flight.id)
                      ? 'text-amber-500 fill-amber-400'
                      : 'text-slate-400'
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => onSelectFlight(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close flight inspector"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Key Schedule & Resource Grid (Unboxed, hairline divided) */}
          <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs border-t border-slate-100 pt-3">
            <div>
              <div className="text-slate-500">Scheduled</div>
              <div className="font-mono tabular-nums text-slate-900 font-medium mt-0.5">
                {formatTime(selectedFlight.flight.schedDep)} → {formatTime(selectedFlight.flight.schedArr)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Actual / Projected</div>
              <div className="font-mono tabular-nums font-semibold mt-0.5 text-slate-900">
                {selectedFlight.status === 'CANCELLED' ? (
                  <span className="text-rose-600">CANCELLED</span>
                ) : (
                  <>
                    {formatTime(selectedFlight.actualDep)} → {formatTime(selectedFlight.actualArr)}
                    {selectedFlight.arrDelayMin > 0 && (
                      <span className="text-amber-700 ml-1">(+{selectedFlight.arrDelayMin}m)</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Aircraft & Crew</div>
              <div className="font-mono text-slate-900 mt-0.5">
                {selectedFlight.effectiveAircraftId} · {selectedFlight.effectiveCrewId}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Manifest / Stranded</div>
              <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                {selectedFlight.flight.passengers} pax
                {selectedFlight.cancelledLocalPax > 0 && (
                  <span className="text-rose-600 font-semibold"> ({selectedFlight.cancelledLocalPax} stranded)</span>
                )}
                {selectedFlight.brokenOutboundConnections > 0 && (
                  <span className="text-amber-700 font-semibold">
                    {' '}
                    ({selectedFlight.brokenOutboundConnections} missed conn)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Before vs After diff if recovery changed this flight */}
          {baselineSelectedFlight &&
            (baselineSelectedFlight.status !== selectedFlight.status ||
              baselineSelectedFlight.arrDelayMin !== selectedFlight.arrDelayMin) && (
              <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                <span className="font-semibold">Recovery Impact:</span>{' '}
                {baselineSelectedFlight.status === 'CANCELLED'
                  ? `Rescued from FDTL Cancellation → ${selectedFlight.status === 'ON_TIME' ? 'On Time' : `+${selectedFlight.arrDelayMin}m`}`
                  : `Delay reduced from +${baselineSelectedFlight.arrDelayMin}m → ${selectedFlight.arrDelayMin === 0 ? 'On Time' : `+${selectedFlight.arrDelayMin}m`}`}
              </div>
            )}

          {/* Crew FDTL Gauge */}
          {selectedFlight.crewDutyAtArrivalMin !== null && (
            <div className="mt-3.5 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">
                  Crew {selectedFlight.effectiveCrewId} Legal Duty (FDTL)
                </span>
                <span
                  className={`font-mono tabular-nums font-semibold ${
                    selectedFlight.crewBreachMin > 0
                      ? 'text-rose-600'
                      : crewPct >= 92
                      ? 'text-amber-700'
                      : 'text-slate-700'
                  }`}
                >
                  {formatDuration(selectedFlight.crewDutyAtArrivalMin)} / {formatDuration(selectedFlight.crewMaxDutyMin)}
                  {selectedFlight.crewBreachMin > 0 ? ` (+${selectedFlight.crewBreachMin}m over)` : ''}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    selectedFlight.crewBreachMin > 0
                      ? 'bg-rose-600'
                      : crewPct >= 92
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.min(100, crewPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* AI Flight Brief & Instant Terminal Gate PA */}
          <div className="mt-3.5 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">AI Flight Brief & Gate PA</span>
              <button
                type="button"
                onClick={handleExplainFlight}
                disabled={briefLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                {briefLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {briefLoading ? 'Drafting...' : flightBrief ? 'Regenerate' : 'Explain with AI'}
              </button>
            </div>

            {briefError && <p className="mt-2 text-[11px] text-rose-600">{briefError}</p>}

            {flightBrief && (
              <div className="mt-2.5 space-y-2.5 text-xs">
                <p className="text-slate-700 leading-relaxed">{flightBrief.plainEnglishSummary}</p>

                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-700">Gate Announcement Script</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCopyGateNotice(flightBrief.passengerGateNotice)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] text-slate-700 cursor-pointer"
                      >
                        {copiedPa ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        {copiedPa ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          voice.speak(
                            `flight-pa-${selectedFlight.flight.id}`,
                            flightBrief.passengerGateNotice,
                            'Polite, clear, reassuring airport terminal gate agent'
                          )
                        }
                        disabled={voice.loadingKey === `flight-pa-${selectedFlight.flight.id}`}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-[11px] cursor-pointer"
                      >
                        {voice.loadingKey === `flight-pa-${selectedFlight.flight.id}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : voice.playingKey === `flight-pa-${selectedFlight.flight.id}` ? (
                          <Square className="w-3 h-3" />
                        ) : (
                          <Volume2 className="w-3 h-3" />
                        )}
                        {voice.playingKey === `flight-pa-${selectedFlight.flight.id}` ? 'Stop' : 'Speak PA'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    "{flightBrief.passengerGateNotice}"
                  </p>
                  {voice.voiceError && <p className="text-[11px] text-rose-600">{voice.voiceError}</p>}
                </div>

                <div className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-800">Next Step:</span> {flightBrief.recommendedNextStep}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step-by-Step Domino Cause Chain */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-slate-900 tracking-tight mb-2.5">
            Domino Cause Chain ({selectedFlight.causeChain.length} {selectedFlight.causeChain.length === 1 ? 'step' : 'steps'})
          </h3>
          {selectedFlight.causeChain.length === 0 ? (
            <p className="text-xs text-slate-500">
              No upstream disruption impacts this flight. Aircraft and crew are operating cleanly on schedule.
            </p>
          ) : (
            <ol className="space-y-3">
              {selectedFlight.causeChain.map((step) => (
                <li key={`${step.stepNumber}-${step.title}`} className="flex gap-2.5 text-xs">
                  <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-500 w-4 shrink-0 pt-0.5">
                    {step.stepNumber}.
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">
                      {step.title}
                    </div>
                    <p className="text-slate-600 leading-relaxed mt-0.5">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Aircraft Rotation Sequence */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-slate-900 mb-2">
            Aircraft {selectedFlight.flight.aircraftId} Full Day Chain
          </h3>
          <div className="space-y-1">
            {tailChain.map((leg) => {
              const isCurr = leg.flight.id === selectedFlight.flight.id;
              return (
                <button
                  key={leg.flight.id}
                  type="button"
                  onClick={() => onSelectFlight(leg.flight.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
                    isCurr ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className="font-mono tabular-nums font-medium">
                    {leg.flight.id} · {leg.flight.origin}→{leg.flight.dest}
                  </span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      isCurr
                        ? 'text-slate-200'
                        : leg.status === 'CANCELLED'
                        ? 'text-rose-600 font-semibold'
                        : leg.status === 'DELAYED'
                        ? 'text-amber-700 font-medium'
                        : 'text-emerald-700'
                    }`}
                  >
                    {leg.status === 'CANCELLED'
                      ? 'Cancelled'
                      : leg.arrDelayMin > 0
                      ? `+${leg.arrDelayMin}m`
                      : 'On Time'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Connections Linked to This Flight */}
        {relatedConnections.length > 0 && (
          <div className="p-4">
            <h3 className="text-xs font-semibold text-slate-900 mb-2">
              Passenger Connections ({relatedConnections.length})
            </h3>
            <div className="space-y-2">
              {relatedConnections.map((sc) => (
                <div
                  key={sc.connection.id}
                  className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0"
                >
                  <div>
                    <div className="font-mono text-slate-900 font-medium">
                      {sc.connection.fromFlightId} → {sc.connection.toFlightId} ({sc.connection.airportCode})
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {sc.connection.passengers} pax · MCT {sc.connection.mctMinutes}m
                      {sc.availableMinutes !== null ? ` · Avail ${sc.availableMinutes}m` : ''}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-medium whitespace-nowrap ${
                      sc.status === 'MISSED_DELAY' || sc.status === 'MISSED_CANCELLED'
                        ? 'text-rose-600'
                        : sc.status === 'SAVED_BY_HOLD'
                        ? 'text-blue-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {sc.status === 'MISSED_DELAY'
                      ? `Missed (${sc.strandedPassengers} stranded)`
                      : sc.status === 'MISSED_CANCELLED'
                      ? 'Broken (Flight Cxl)'
                      : sc.status === 'SAVED_BY_HOLD'
                      ? 'Saved by Hold'
                      : 'Intact'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Flight-Specific Recovery Levers */}
        {matchingActions.length > 0 && (
          <div className="p-4 bg-slate-50/70">
            <h3 className="text-xs font-semibold text-slate-900 mb-2">
              Direct Recovery Actions for {selectedFlight.flight.id}
            </h3>
            <div className="space-y-1.5">
              {matchingActions.slice(0, 4).map((act) => {
                const isActive = activeActions.some((a) => a.id === act.id);
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onToggleAction(act)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-50 border-blue-400 text-blue-950'
                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{act.label}</span>
                      <span className="text-[11px] font-semibold text-blue-700 shrink-0">
                        {isActive ? 'Active' : 'Apply'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // === 2. AIRPORT OPERATIONS INSPECTOR ===
  if (selectedAirport) {
    const depFlights = result.flights.filter((f) => f.flight.origin === selectedAirport.code);
    const arrFlights = result.flights.filter((f) => f.flight.dest === selectedAirport.code);
    const airportConns = result.connections.filter((c) => c.connection.airportCode === selectedAirport.code);
    const stationedSpares = dataset.spares.filter((s) => s.baseAirport === selectedAirport.code);
    const stationedCrews = dataset.standbyCrews.filter((c) => c.baseAirport === selectedAirport.code);
    const isClosed = result.disruption?.airportCode === selectedAirport.code;

    return (
      <div className="flex flex-col h-full overflow-y-auto divide-y divide-slate-200">
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-base font-bold font-display text-slate-900">
                {selectedAirport.code} · {selectedAirport.city}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {selectedAirport.name} · MCT {selectedAirport.mctMinutes}m
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectAirport(null)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              aria-label="Close airport inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onCloseAirportPreset(selectedAirport.code)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {isClosed ? `Closing ${selectedAirport.code} Now` : `Simulate 90m Closure at ${selectedAirport.code}`}
            </button>
          </div>

          {(stationedSpares.length > 0 || stationedCrews.length > 0) && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
              {stationedSpares.map((s) => (
                <div key={s.id} className="font-mono tabular-nums">
                  Spare: <span className="text-slate-900 font-medium">{s.id}</span> ({s.model}, ready {formatTime(s.readyFrom)})
                </div>
              ))}
              {stationedCrews.map((c) => (
                <div key={c.id} className="font-mono tabular-nums">
                  Standby Crew: <span className="text-slate-900 font-medium">{c.id}</span> (ready {formatTime(c.readyFrom)})
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4">
          <h3 className="text-xs font-semibold text-slate-900 mb-2">
            Departures ({depFlights.length}) & Arrivals ({arrFlights.length})
          </h3>
          <div className="space-y-1">
            {[...depFlights, ...arrFlights]
              .sort((a, b) => a.flight.schedDep - b.flight.schedDep)
              .map((sf) => {
                const isDep = sf.flight.origin === selectedAirport.code;
                return (
                  <button
                    key={`${sf.flight.id}-${isDep ? 'd' : 'a'}`}
                    type="button"
                    onClick={() => onSelectFlight(sf.flight.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-xs cursor-pointer"
                  >
                    <span className="font-mono tabular-nums text-slate-800">
                      <span className="text-slate-400 mr-1.5">{isDep ? 'DEP' : 'ARR'}</span>
                      <span className="font-semibold">{sf.flight.id}</span> {sf.flight.origin}→{sf.flight.dest}
                    </span>
                    <span
                      className={`font-mono tabular-nums text-[11px] ${
                        sf.status === 'CANCELLED'
                          ? 'text-rose-600 font-semibold'
                          : sf.status === 'DELAYED'
                          ? 'text-amber-700 font-medium'
                          : 'text-emerald-700'
                      }`}
                    >
                      {sf.status === 'CANCELLED'
                        ? 'Cancelled'
                        : sf.arrDelayMin > 0
                        ? `+${sf.arrDelayMin}m`
                        : formatTime(isDep ? sf.actualDep : sf.actualArr)}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>

        {airportConns.length > 0 && (
          <div className="p-4">
            <h3 className="text-xs font-semibold text-slate-900 mb-2">
              Hub Connections ({airportConns.length})
            </h3>
            <div className="space-y-1.5 text-xs">
              {airportConns.map((c) => (
                <div key={c.connection.id} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
                  <span className="font-mono text-slate-800">
                    {c.connection.fromFlightId} → {c.connection.toFlightId} ({c.connection.passengers} pax)
                  </span>
                  <span
                    className={
                      c.status === 'MISSED_DELAY' || c.status === 'MISSED_CANCELLED'
                        ? 'text-rose-600 font-medium'
                        : 'text-emerald-700'
                    }
                  >
                    {c.status === 'MISSED_DELAY'
                      ? `Missed (-${c.shortfallMinutes}m)`
                      : c.status === 'MISSED_CANCELLED'
                      ? 'Flight Cxl'
                      : 'Intact'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // === 3. DEFAULT OVERVIEW: CRITICAL DOMINO IMPACTS ===
  const cancelledFlights = result.flights.filter((f) => f.status === 'CANCELLED');
  const crewCascadeFlights = result.flights.filter((f) => f.rootCause === 'CREW_CASCADE');
  const topDelayedFlights = result.flights
    .filter((f) => f.status === 'DELAYED')
    .sort((a, b) => b.arrDelayMin - a.arrDelayMin)
    .slice(0, 8);
  const brokenConnections = result.connections.filter((c) => c.status === 'MISSED_DELAY');

  if (!result.disruption) {
    return (
      <div className="p-6 flex flex-col justify-center items-start h-full text-sm">
        <div className="flex items-center gap-2 text-emerald-700 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>Network Operating Nominally</span>
        </div>
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
          All 70 flights across 16 Indian airports, 16 aircraft, and 40 passenger connections are operating on time with zero crew duty breaches.
        </p>
        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          Close any airport using the control bar above—or click any airport node on the map—to watch delays propagate through aircraft turns, crew handoffs, and hub connections.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto divide-y divide-slate-200">
      {/* Prompt to run AI Dispatcher */}
      <div className="p-4 bg-slate-50/80">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              {result.disruption.airportCode} {result.disruption.reason} Cascade
            </div>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              Click any flight below or on the map to trace its exact domino chain from {result.disruption.airportCode}.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAIDispatcher}
            className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            AI Recovery
          </button>
        </div>
      </div>

      {/* Cancelled Flights (Highest Priority) */}
      {cancelledFlights.length > 0 && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              Cancelled Flights ({cancelledFlights.length})
            </h3>
            <span className="text-[11px] font-mono tabular-nums text-rose-600">
              {result.summary.strandedFromCancellations} pax stranded
            </span>
          </div>
          <div className="space-y-1.5">
            {cancelledFlights.map((sf) => (
              <button
                key={sf.flight.id}
                type="button"
                onClick={() => onSelectFlight(sf.flight.id)}
                className="w-full text-left p-2.5 rounded-lg border border-rose-200 bg-rose-50/50 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-900">
                    {sf.flight.id} · {sf.flight.origin}→{sf.flight.dest}
                  </span>
                  <span className="font-mono tabular-nums text-rose-700 font-semibold">
                    {sf.cancelledLocalPax} pax
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-rose-800 leading-snug">
                  {sf.causeSummary}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cross-Aircraft Crew Cascades */}
      {crewCascadeFlights.length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-semibold text-purple-800 mb-2">
            Cross-Aircraft Crew Cascade ({crewCascadeFlights.length})
          </h3>
          <div className="space-y-1.5">
            {crewCascadeFlights.map((sf) => (
              <button
                key={sf.flight.id}
                type="button"
                onClick={() => onSelectFlight(sf.flight.id)}
                className="w-full text-left p-2.5 rounded-lg border border-purple-200 bg-purple-50/40 hover:bg-purple-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-900">
                    {sf.flight.id} · {sf.flight.origin}→{sf.flight.dest}
                  </span>
                  <span className="font-mono tabular-nums text-purple-800 font-semibold">
                    +{sf.arrDelayMin}m
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-purple-900">{sf.causeSummary}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top Delayed Flights */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-900">
            Most Delayed Flights ({result.summary.delayedFlights} total)
          </h3>
          <span className="text-[11px] font-mono tabular-nums text-slate-500">
            {result.summary.totalDelayMinutes.toLocaleString()}m sum
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {topDelayedFlights.map((sf) => (
            <button
              key={sf.flight.id}
              type="button"
              onClick={() => onSelectFlight(sf.flight.id)}
              className="w-full flex items-center justify-between py-2 text-left hover:bg-slate-50 px-1.5 -mx-1.5 rounded transition-colors cursor-pointer"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-mono font-semibold text-slate-900">{sf.flight.id}</span>
                  <span className="font-mono text-slate-600">
                    {sf.flight.origin}→{sf.flight.dest}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-[11px] text-slate-500">{sf.effectiveAircraftId}</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">{sf.causeSummary}</div>
              </div>
              <span className="font-mono tabular-nums text-xs font-semibold text-amber-700 shrink-0">
                +{sf.arrDelayMin}m
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Broken Passenger Connections */}
      {brokenConnections.length > 0 && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-900">
              Broken Connections ({brokenConnections.length})
            </h3>
            <span className="text-[11px] font-mono tabular-nums text-amber-700 font-medium">
              {result.summary.strandedFromMissedConnections} pax missed
            </span>
          </div>
          <div className="space-y-1.5">
            {brokenConnections.slice(0, 6).map((sc) => (
              <button
                key={sc.connection.id}
                type="button"
                onClick={() => onSelectFlight(sc.connection.fromFlightId)}
                className="w-full flex items-center justify-between text-xs py-1.5 px-1.5 -mx-1.5 rounded hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="font-mono text-slate-800">
                  {sc.connection.fromFlightId} → {sc.connection.toFlightId}{' '}
                  <span className="text-slate-500">at {sc.connection.airportCode}</span>
                </span>
                <span className="font-mono tabular-nums text-rose-600 font-medium">
                  {sc.strandedPassengers} pax (−{sc.shortfallMinutes}m)
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
