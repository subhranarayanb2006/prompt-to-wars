import React, { useMemo, useState } from 'react';
import { Columns2, Flag, GitCommitHorizontal } from 'lucide-react';
import { NetworkDataset, SimulatedFlight, SimulationResult } from '../types/network';
import { formatDuration, formatTime } from '../utils/time';

interface FleetTimelineViewProps {
  dataset: NetworkDataset;
  result: SimulationResult;
  baseline: SimulationResult;
  selectedFlightId: string | null;
  onSelectFlight: (flightId: string) => void;
}

const START_MIN = 300; // 05:00
const END_MIN = 1260; // 21:00
const SPAN_MIN = END_MIN - START_MIN;

function pct(min: number): number {
  return Math.max(0, Math.min(100, ((min - START_MIN) / SPAN_MIN) * 100));
}

function getBlockStyle(sf: SimulatedFlight) {
  if (sf.status === 'CANCELLED') {
    return {
      bg: 'bg-rose-100 border-rose-500 text-rose-950 border-dashed',
      tag: sf.rootCause === 'CREW_FDTL_CANCELLED' ? 'CXL·FDTL' : 'CXL',
    };
  }
  if (sf.isRecoveredByAction && sf.status === 'ON_TIME') {
    return {
      bg: 'bg-emerald-100 border-emerald-500 text-emerald-950',
      tag: 'RECOVERED',
    };
  }
  if (sf.rootCause === 'CREW_CASCADE') {
    return {
      bg: 'bg-purple-100 border-purple-400 text-purple-950',
      tag: `+${sf.arrDelayMin}m CREW`,
    };
  }
  if (sf.status === 'DELAYED') {
    return {
      bg:
        sf.arrDelayMin >= 45
          ? 'bg-orange-100 border-orange-400 text-orange-950'
          : 'bg-amber-100 border-amber-400 text-amber-950',
      tag: `+${sf.arrDelayMin}m`,
    };
  }
  return {
    bg: 'bg-emerald-50/70 border-emerald-300/80 text-slate-800',
    tag: '',
  };
}

interface TimelineBoardProps {
  title?: string;
  subtitle?: string;
  tone?: 'neutral' | 'disrupted' | 'recovered';
  dataset: NetworkDataset;
  sim: SimulationResult;
  onlyAffected: boolean;
  selectedFlightId: string | null;
  lineageSet: Set<string>;
  compact?: boolean;
  onSelectFlight: (flightId: string) => void;
}

const TimelineBoard: React.FC<TimelineBoardProps> = ({
  title,
  subtitle,
  tone = 'neutral',
  dataset,
  sim,
  onlyAffected,
  selectedFlightId,
  lineageSet,
  compact = false,
  onSelectFlight,
}) => {
  const crewById = useMemo(
    () => new Map(sim.crews.map((c) => [c.crew.id, c])),
    [sim.crews]
  );

  const activeSpareIds = new Set(
    sim.flights
      .filter((f) => dataset.spares.some((s) => s.id === f.effectiveAircraftId))
      .map((f) => f.effectiveAircraftId)
  );

  const aircraftRows = [
    ...dataset.aircraft.map((ac) => ({
      id: ac.id,
      model: ac.model,
      minTurnaroundMin: ac.minTurnaroundMin,
      isSpare: false,
      flights: sim.flights
        .filter((f) => f.effectiveAircraftId === ac.id)
        .sort((a, b) => a.flight.schedDep - b.flight.schedDep),
    })),
    ...dataset.spares
      .filter((sp) => activeSpareIds.has(sp.id))
      .map((sp) => ({
        id: sp.id,
        model: `${sp.model} · Spare`,
        minTurnaroundMin: 35,
        isSpare: true,
        flights: sim.flights
          .filter((f) => f.effectiveAircraftId === sp.id)
          .sort((a, b) => a.flight.schedDep - b.flight.schedDep),
      })),
  ].filter((row) => {
    if (!onlyAffected) return true;
    return row.flights.some((f) => f.status !== 'ON_TIME' || f.isRecoveredByAction);
  });

  const hours = [6, 8, 10, 12, 14, 16, 18, 20];
  const disruptions = sim.disruptions;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      {title && (
        <div
          className={`px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 text-xs ${
            tone === 'disrupted'
              ? 'bg-rose-50/80 text-rose-950'
              : tone === 'recovered'
              ? 'bg-emerald-50/80 text-emerald-950'
              : 'bg-slate-50 text-slate-900'
          }`}
        >
          <span className="font-bold">{title}</span>
          {subtitle && <span className="font-mono tabular-nums text-[11px] opacity-85">{subtitle}</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <div className={compact ? 'min-w-[680px]' : 'min-w-[980px]'}>
          {/* Time Axis Header */}
          <div className="flex border-b border-slate-200 bg-slate-50 text-[11px] font-mono tabular-nums text-slate-500">
            <div className={`${compact ? 'w-36' : 'w-48'} shrink-0 px-3 py-2 border-r border-slate-200 font-sans font-medium text-slate-700`}>
              Aircraft · FDTL
            </div>
            <div className="flex-1 relative h-8">
              {hours.map((hr) => (
                <div
                  key={hr}
                  className="absolute top-0 bottom-0 flex items-center border-l border-slate-200/80 pl-1"
                  style={{ left: `${pct(hr * 60)}%` }}
                >
                  {String(hr).padStart(2, '0')}:00
                </div>
              ))}
              {disruptions.map((d, idx) => (
                <div
                  key={`hdr-${d.airportCode}-${idx}`}
                  className="absolute top-0 bottom-0 bg-rose-500/15 border-x border-rose-400/70 flex items-center justify-center text-[10px] font-semibold text-rose-700 overflow-hidden px-1"
                  style={{
                    left: `${pct(d.startMin)}%`,
                    width: `${Math.max(1.8, pct(d.endMin) - pct(d.startMin))}%`,
                  }}
                >
                  {d.airportCode}
                </div>
              ))}
            </div>
          </div>

          {/* Aircraft Swimlanes */}
          <div className="divide-y divide-slate-200">
            {aircraftRows.map((row) => {
              const totalChainDelay = row.flights.reduce((sum, f) => sum + f.arrDelayMin, 0);
              const cancelCount = row.flights.filter((f) => f.status === 'CANCELLED').length;
              const compressedTurns = row.flights.filter((f) => f.turnaroundCompressedMin > 0).length;

              // Find whether any crew operating this aircraft hit or approached legal FDTL ceiling
              const rowCrewAlerts = row.flights
                .map((f) => crewById.get(f.effectiveCrewId))
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
                .filter((c) => c.breached || c.utilizationPct >= 95);
              const breachedCrew = rowCrewAlerts.find((c) => c.breached) ?? rowCrewAlerts[0] ?? null;

              return (
                <div key={row.id} className="flex hover:bg-slate-50/50 transition-colors">
                  {/* Aircraft Meta & Crew FDTL Warning Flag */}
                  <div className={`${compact ? 'w-36' : 'w-48'} shrink-0 px-3 py-2.5 border-r border-slate-200 flex flex-col justify-center`}>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`font-mono text-xs font-semibold ${
                          row.isSpare ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {row.id}
                      </span>
                      <span className="font-mono tabular-nums text-[10px] text-slate-500">
                        {row.flights.length} legs
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">{row.model}</div>
                    {(totalChainDelay > 0 || cancelCount > 0 || compressedTurns > 0) && (
                      <div className="mt-1 text-[10px] font-mono tabular-nums flex flex-wrap gap-x-2">
                        {cancelCount > 0 && (
                          <span className="text-rose-600 font-semibold">{cancelCount} cxl</span>
                        )}
                        {totalChainDelay > 0 && (
                          <span className="text-amber-700 font-medium">+{formatDuration(totalChainDelay)}</span>
                        )}
                        {compressedTurns > 0 && !compact && (
                          <span className="text-orange-700">{compressedTurns} turn squeeze</span>
                        )}
                      </div>
                    )}
                    {breachedCrew && (
                      <div
                        className={`mt-1 inline-flex items-center gap-1 text-[10px] font-mono font-semibold ${
                          breachedCrew.breached ? 'text-rose-700' : 'text-amber-700'
                        }`}
                        title={`${breachedCrew.crew.id}: ${breachedCrew.dutyMinutesUsed}m / ${breachedCrew.maxDutyMinutes}m legal duty (${breachedCrew.utilizationPct}%)`}
                      >
                        <Flag className="w-3 h-3 shrink-0 fill-current" />
                        <span className="truncate">
                          {breachedCrew.breached
                            ? `${breachedCrew.crew.id} FDTL BREACH`
                            : `${breachedCrew.crew.id} ${breachedCrew.utilizationPct}% FDTL`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Swimlane Gantt Track */}
                  <div className="flex-1 relative h-16">
                    {/* Hour Gridlines */}
                    {hours.map((hr) => (
                      <div
                        key={hr}
                        className="absolute top-0 bottom-0 border-l border-slate-100 pointer-events-none"
                        style={{ left: `${pct(hr * 60)}%` }}
                      />
                    ))}

                    {/* Closure Bands */}
                    {disruptions.map((d, idx) => (
                      <div
                        key={`band-${row.id}-${d.airportCode}-${idx}`}
                        className="absolute top-0 bottom-0 bg-rose-500/8 border-x border-rose-200/70 pointer-events-none"
                        style={{
                          left: `${pct(d.startMin)}%`,
                          width: `${Math.max(1.8, pct(d.endMin) - pct(d.startMin))}%`,
                        }}
                      />
                    ))}

                    {/* Flights + Hatched Compressed Turnaround Buffer Zones */}
                    {row.flights.map((sf, legIdx) => {
                      const prevLeg = legIdx > 0 ? row.flights[legIdx - 1] : null;
                      const schedLeft = pct(sf.flight.schedDep);
                      const schedWidth = Math.max(2, pct(sf.flight.schedArr) - schedLeft);

                      const actualStart = sf.actualDep ?? sf.flight.schedDep;
                      const actualEnd = sf.actualArr ?? sf.flight.schedArr;
                      const actualLeft = pct(actualStart);
                      const actualWidth = Math.max(2.4, pct(actualEnd) - actualLeft);

                      const style = getBlockStyle(sf);
                      const isSelected = selectedFlightId === sf.flight.id;
                      const inLineage = lineageSet.has(sf.flight.id);
                      const dimUnrelated = lineageSet.size > 0 && !inLineage;

                      // Hatched Turnaround Buffer Zone whenever turnaround time was compressed
                      const showCompressedBuffer =
                        prevLeg &&
                        prevLeg.actualArr !== null &&
                        sf.actualDep !== null &&
                        sf.turnaroundCompressedMin > 0 &&
                        sf.actualDep > prevLeg.actualArr;
                      const bufLeft = showCompressedBuffer ? pct(prevLeg.actualArr!) : 0;
                      const bufWidth = showCompressedBuffer
                        ? Math.max(0.8, pct(sf.actualDep!) - bufLeft)
                        : 0;

                      return (
                        <React.Fragment key={sf.flight.id}>
                          {/* Hatched Compressed Turnaround Zone */}
                          {showCompressedBuffer && (
                            <div
                              title={`Turnaround compressed at ${sf.flight.origin}: ${sf.actualTurnaroundMin}m actual vs ${sf.scheduledTurnaroundMin}m scheduled (absorbed ${sf.turnaroundCompressedMin}m buffer)`}
                              className="absolute top-4 h-8 rounded-xs border border-amber-500/80 z-[5] pointer-events-auto"
                              style={{
                                left: `${bufLeft}%`,
                                width: `${bufWidth}%`,
                                backgroundImage:
                                  'repeating-linear-gradient(135deg, rgba(245,158,11,0.34), rgba(245,158,11,0.34) 4px, rgba(254,243,199,0.75) 4px, rgba(254,243,199,0.75) 8px)',
                              }}
                            />
                          )}

                          {/* Ghost Scheduled Block when shifted */}
                          {sf.status === 'DELAYED' && (
                            <div
                              className="absolute top-2 h-11 rounded border border-dashed border-slate-300 bg-slate-100/40 pointer-events-none"
                              style={{ left: `${schedLeft}%`, width: `${schedWidth}%` }}
                            />
                          )}

                          {/* Actual / Cancelled Flight Block */}
                          <button
                            type="button"
                            onClick={() => onSelectFlight(sf.flight.id)}
                            title={`${sf.flight.id} ${sf.flight.origin}→${sf.flight.dest} | Sched ${formatTime(sf.flight.schedDep)}–${formatTime(sf.flight.schedArr)} | ${sf.causeSummary}`}
                            className={`absolute top-2.5 h-11 rounded-md border px-1.5 text-left overflow-hidden transition-all cursor-pointer ${style.bg} ${
                              isSelected
                                ? 'ring-2 ring-blue-600 z-30 shadow-md'
                                : inLineage
                                ? 'ring-2 ring-amber-500 z-20'
                                : 'z-10 hover:z-20'
                            } ${dimUnrelated ? 'opacity-35' : 'opacity-100'}`}
                            style={{ left: `${actualLeft}%`, width: `${actualWidth}%` }}
                          >
                            <div className="flex items-center justify-between gap-1 text-[10px] font-mono font-semibold leading-tight">
                              <span className="truncate flex items-center gap-0.5">
                                {sf.rootCause === 'CREW_FDTL_CANCELLED' && (
                                  <Flag className="w-2.5 h-2.5 text-rose-700 fill-rose-600 shrink-0" />
                                )}
                                {sf.flight.id}
                              </span>
                              {style.tag && <span className="shrink-0 opacity-90">{style.tag}</span>}
                            </div>
                            <div className="text-[10px] font-mono tabular-nums opacity-80 truncate leading-tight mt-0.5">
                              {sf.flight.origin}→{sf.flight.dest}
                            </div>
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export const FleetTimelineView: React.FC<FleetTimelineViewProps> = ({
  dataset,
  result,
  baseline,
  selectedFlightId,
  onSelectFlight,
}) => {
  const [compareMode, setCompareMode] = useState<'after' | 'before' | 'split'>('after');
  const [onlyAffected, setOnlyAffected] = useState(false);

  const hasRecovery = result.actions.length > 0;
  const effectiveMode = hasRecovery ? compareMode : 'after';

  // Compute Domino Lineage across swimlanes for selectedFlightId
  const lineageInfo = useMemo(() => {
    const ids = new Set<string>();
    const ordered: SimulatedFlight[] = [];
    if (!selectedFlightId) return { ids, ordered };
    const sim = effectiveMode === 'before' ? baseline : result;
    const sf = sim.flightsById[selectedFlightId];
    if (!sf) return { ids, ordered };
    for (const step of sf.causeChain) {
      if (step.flightId && !ids.has(step.flightId) && sim.flightsById[step.flightId]) {
        ids.add(step.flightId);
        ordered.push(sim.flightsById[step.flightId]);
      }
    }
    if (!ids.has(sf.flight.id)) {
      ids.add(sf.flight.id);
      ordered.push(sf);
    }
    return { ids, ordered };
  }, [selectedFlightId, effectiveMode, baseline, result]);

  return (
    <div className="bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.15)] space-y-4 p-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Aircraft Rotation Swimlanes &amp; Domino Propagation Timeline
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Dashed ghost outlines show original schedule; hatched amber blocks mark compressed turnarounds; red flags mark crew FDTL limits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {hasRecovery && (
            <div className="flex items-center gap-1 p-1 bg-slate-200/75 rounded-lg">
              <button
                type="button"
                onClick={() => setCompareMode('before')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  effectiveMode === 'before'
                    ? 'bg-white text-rose-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Disrupted (Before)
              </button>
              <button
                type="button"
                onClick={() => setCompareMode('after')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  effectiveMode === 'after'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Recovered (After)
              </button>
              <button
                type="button"
                onClick={() => setCompareMode('split')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  effectiveMode === 'split'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
                Split Compare
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setOnlyAffected((v) => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
              onlyAffected
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            {onlyAffected ? 'Showing Affected Chains' : 'Filter: Affected Only'}
          </button>
        </div>
      </div>

      {/* Legend + Domino Lineage Tracer Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-2.5 rounded-xs border border-dashed border-slate-400 bg-slate-100 inline-block" />
            Scheduled Ghost
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3.5 h-2.5 rounded-xs border border-amber-500 inline-block"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(245,158,11,0.45), rgba(245,158,11,0.45) 3px, #FEF3C7 3px, #FEF3C7 6px)',
              }}
            />
            Compressed Turnaround
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-700 font-medium">
            <Flag className="w-3 h-3 fill-rose-600" />
            Crew FDTL Ceiling
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3.5 h-2.5 rounded-xs border border-emerald-500 bg-emerald-100 inline-block" />
            On Time / Recovered
          </span>
        </div>

        {lineageInfo.ordered.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1">
            <GitCommitHorizontal className="w-3.5 h-3.5 text-blue-700 shrink-0" />
            <span className="font-semibold text-slate-700">Lineage:</span>
            {lineageInfo.ordered.map((f, idx) => (
              <React.Fragment key={f.flight.id}>
                {idx > 0 && <span className="text-slate-400">→</span>}
                <span className="font-mono font-semibold text-slate-900">
                  {f.flight.id} ({f.status === 'CANCELLED' ? 'CXL' : `+${f.arrDelayMin}m`})
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Single Timeline or Side-by-Side Split View (Disrupted vs Recovered) */}
      {effectiveMode === 'split' && hasRecovery ? (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
          <TimelineBoard
            title="Unrecovered Timeline (Disrupted Baseline)"
            subtitle={`${baseline.summary.delayedFlights} delayed · ${baseline.summary.cancelledFlights} cancelled · ${baseline.summary.strandedPassengers} stranded`}
            tone="disrupted"
            dataset={dataset}
            sim={baseline}
            onlyAffected={onlyAffected}
            selectedFlightId={selectedFlightId}
            lineageSet={lineageInfo.ids}
            compact
            onSelectFlight={onSelectFlight}
          />
          <TimelineBoard
            title={`Recovered Timeline (${result.actions.length} Action${result.actions.length === 1 ? '' : 's'})`}
            subtitle={`${result.summary.delayedFlights} delayed · ${result.summary.cancelledFlights} cancelled · ${result.summary.strandedPassengers} stranded`}
            tone="recovered"
            dataset={dataset}
            sim={result}
            onlyAffected={onlyAffected}
            selectedFlightId={selectedFlightId}
            lineageSet={lineageInfo.ids}
            compact
            onSelectFlight={onSelectFlight}
          />
        </div>
      ) : (
        <TimelineBoard
          dataset={dataset}
          sim={effectiveMode === 'before' ? baseline : result}
          onlyAffected={onlyAffected}
          selectedFlightId={selectedFlightId}
          lineageSet={lineageInfo.ids}
          onSelectFlight={onSelectFlight}
        />
      )}
    </div>
  );
};
