import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, X } from 'lucide-react';
import { Airport, SimulationResult } from '../types/network';
import { formatDelta } from '../utils/time';

const CHART_BACKDROP_SRC = '/src/assets/images/chart_twilight_backdrop_1795152240004.jpg';

interface AirportDelayChartProps {
  compact?: boolean;
  airports: Airport[];
  baseline: SimulationResult;
  result: SimulationResult;
  hasRecovery: boolean;
}

type AttributionMode = 'origin' | 'dest';

interface AirportDelayDatum {
  code: string;
  city: string;
  tier: Airport['tier'];
  isClosedAirport: boolean;
  baselineDelay: number;
  recoveryDelay: number;
  deltaDelay: number;
  baselineDelayedFlights: number;
  recoveryDelayedFlights: number;
  baselineCancelledFlights: number;
  recoveryCancelledFlights: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: AirportDelayDatum }>;
  attribution: AttributionMode;
  hasRecovery: boolean;
}

const AirportTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  attribution,
  hasRecovery,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;

  const deltaLabel =
    d.deltaDelay < 0
      ? `Saved ${Math.abs(d.deltaDelay)}m`
      : d.deltaDelay > 0
      ? `+${d.deltaDelay}m added`
      : 'Unchanged';

  const deltaColor =
    d.deltaDelay < 0
      ? 'text-emerald-700'
      : d.deltaDelay > 0
      ? 'text-rose-600'
      : 'text-slate-500';

  return (
    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[215px]">
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
        <div className="font-semibold text-slate-900">
          <span className="font-mono">{d.code}</span>
          <span className="text-slate-400 font-normal mx-1">·</span>
          <span>{d.city}</span>
        </div>
        {d.isClosedAirport && (
          <span className="text-[10px] font-semibold text-rose-700">Closed Hub</span>
        )}
      </div>

      <div className="mt-2 space-y-1.5 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block shrink-0" />
            Baseline
          </span>
          <span className="font-semibold text-slate-900">
            {d.baselineDelay}m{' '}
            <span className="text-[10px] font-normal text-slate-500">
              ({d.baselineDelayedFlights} {d.baselineDelayedFlights === 1 ? 'flt' : 'flts'})
            </span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block shrink-0" />
            Recovery Plan
          </span>
          <span className="font-semibold text-slate-900">
            {d.recoveryDelay}m{' '}
            <span className="text-[10px] font-normal text-slate-500">
              ({d.recoveryDelayedFlights} {d.recoveryDelayedFlights === 1 ? 'flt' : 'flts'})
            </span>
          </span>
        </div>

        <div className="pt-1.5 mt-1.5 border-t border-slate-100 flex items-center justify-between gap-4">
          <span className="text-slate-500 font-sans">Net Change</span>
          <span className={`font-semibold ${deltaColor}`}>
            {hasRecovery ? deltaLabel : 'No recovery active'}
          </span>
        </div>

        {(d.baselineCancelledFlights > 0 || d.recoveryCancelledFlights > 0) && (
          <div className="text-[10px] text-slate-500 font-sans pt-0.5">
            Cancelled {attribution === 'origin' ? 'departures' : 'arrivals'}:{' '}
            <span className="font-mono text-slate-800">
              {d.baselineCancelledFlights} → {d.recoveryCancelledFlights}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const AirportDelayChart: React.FC<AirportDelayChartProps> = ({
  compact = false,
  airports,
  baseline,
  result,
  hasRecovery,
}) => {
  const [attribution, setAttribution] = useState<AttributionMode>('origin');
  const [pinnedAirportCode, setPinnedAirportCode] = useState<string | null>(null);
  const [backdropFailed, setBackdropFailed] = useState(false);

  const closedCode = baseline.disruption?.airportCode ?? null;

  const chartData: AirportDelayDatum[] = useMemo(() => {
    const baseDelayMap = new Map<string, number>();
    const recDelayMap = new Map<string, number>();
    const baseDelayedCountMap = new Map<string, number>();
    const recDelayedCountMap = new Map<string, number>();
    const baseCancelCountMap = new Map<string, number>();
    const recCancelCountMap = new Map<string, number>();

    for (const sf of baseline.flights) {
      const code = attribution === 'origin' ? sf.flight.origin : sf.flight.dest;
      if (sf.status === 'DELAYED') {
        baseDelayMap.set(code, (baseDelayMap.get(code) ?? 0) + sf.arrDelayMin);
        baseDelayedCountMap.set(code, (baseDelayedCountMap.get(code) ?? 0) + 1);
      } else if (sf.status === 'CANCELLED') {
        baseCancelCountMap.set(code, (baseCancelCountMap.get(code) ?? 0) + 1);
      }
    }

    for (const sf of result.flights) {
      const code = attribution === 'origin' ? sf.flight.origin : sf.flight.dest;
      if (sf.status === 'DELAYED') {
        recDelayMap.set(code, (recDelayMap.get(code) ?? 0) + sf.arrDelayMin);
        recDelayedCountMap.set(code, (recDelayedCountMap.get(code) ?? 0) + 1);
      } else if (sf.status === 'CANCELLED') {
        recCancelCountMap.set(code, (recCancelCountMap.get(code) ?? 0) + 1);
      }
    }

    return airports
      .map((ap) => {
        const baselineDelay = baseDelayMap.get(ap.code) ?? 0;
        const recoveryDelay = recDelayMap.get(ap.code) ?? 0;
        return {
          code: ap.code,
          city: ap.city,
          tier: ap.tier,
          isClosedAirport: ap.code === closedCode,
          baselineDelay,
          recoveryDelay,
          deltaDelay: recoveryDelay - baselineDelay,
          baselineDelayedFlights: baseDelayedCountMap.get(ap.code) ?? 0,
          recoveryDelayedFlights: recDelayedCountMap.get(ap.code) ?? 0,
          baselineCancelledFlights: baseCancelCountMap.get(ap.code) ?? 0,
          recoveryCancelledFlights: recCancelCountMap.get(ap.code) ?? 0,
        };
      })
      .sort(
        (a, b) =>
          b.baselineDelay - a.baselineDelay ||
          b.recoveryDelay - a.recoveryDelay ||
          a.code.localeCompare(b.code)
      );
  }, [airports, baseline.flights, result.flights, attribution, closedCode]);

  const stats = useMemo(() => {
    const baselineTotal = chartData.reduce((s, d) => s + d.baselineDelay, 0);
    const recoveryTotal = chartData.reduce((s, d) => s + d.recoveryDelay, 0);
    const improvedAirports = chartData.filter((d) => d.deltaDelay < 0).length;
    const impactedBaselineAirports = chartData.filter((d) => d.baselineDelay > 0).length;
    return {
      baselineTotal,
      recoveryTotal,
      deltaTotal: recoveryTotal - baselineTotal,
      improvedAirports,
      impactedBaselineAirports,
    };
  }, [chartData]);

  const pinnedAirport = useMemo(
    () => (pinnedAirportCode ? chartData.find((d) => d.code === pinnedAirportCode) ?? null : null),
    [chartData, pinnedAirportCode]
  );

  const pinnedFlights = useMemo(() => {
    if (!pinnedAirportCode) return [];
    return baseline.flights
      .filter((bf) => {
        const code = attribution === 'origin' ? bf.flight.origin : bf.flight.dest;
        if (code !== pinnedAirportCode) return false;
        const rf = result.flightsById[bf.flight.id];
        return bf.status !== 'ON_TIME' || (rf && rf.status !== 'ON_TIME');
      })
      .map((bf) => ({
        base: bf,
        rec: result.flightsById[bf.flight.id] ?? bf,
      }))
      .sort((a, b) => b.base.arrDelayMin - a.base.arrDelayMin);
  }, [pinnedAirportCode, baseline.flights, result.flightsById, attribution]);

  return (
    <section
      aria-label="Airport delay distribution comparison chart"
      className={compact ? 'p-3' : ''}
    >
      <div
        className={`relative overflow-hidden rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 text-slate-100 ${
          compact ? 'p-4 space-y-3' : 'p-5 space-y-3.5'
        }`}
      >
        {/* High-Altitude Twilight Atmospheric Backdrop */}
        {!backdropFailed && (
          <img
            src={CHART_BACKDROP_SRC}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setBackdropFailed(true)}
            className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover object-center opacity-55"
          />
        )}
        {/* Measured Contrast Scrim for WCAG AA+ Text & Bar Legibility */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/78 via-slate-950/58 to-slate-950/84"
        />

        {/* Foreground Content */}
        <div className="relative z-10 space-y-3.5">
          {/* Header & Attribution Switch */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-white flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                Delay Minutes by Airport ({airports.length} Airports)
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-300 font-mono tabular-nums">
                <span>
                  Baseline <strong className="text-white">{stats.baselineTotal.toLocaleString()}m</strong>
                </span>
                <span className="text-slate-500" aria-hidden="true">·</span>
                <span>
                  Recovery <strong className="text-white">{stats.recoveryTotal.toLocaleString()}m</strong>
                </span>
                {hasRecovery ? (
                  <>
                    <span className="text-slate-500" aria-hidden="true">·</span>
                    <span
                      className={
                        stats.deltaTotal < 0
                          ? 'font-semibold text-emerald-300'
                          : stats.deltaTotal > 0
                          ? 'font-semibold text-rose-300'
                          : 'text-slate-300'
                      }
                    >
                      {formatDelta(stats.deltaTotal, 'm')} ({stats.improvedAirports}{' '}
                      {stats.improvedAirports === 1 ? 'airport' : 'airports'} reduced)
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500" aria-hidden="true">·</span>
                    <span className="font-sans text-slate-300">
                      Apply a recovery plan to compare reductions
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Departures vs Arrivals Attribution Toggle */}
            <div className="flex items-center gap-1 p-0.5 bg-white/10 border border-white/15 backdrop-blur-sm rounded-lg shrink-0">
              {(
                [
                  { id: 'origin', label: 'By Departure' },
                  { id: 'dest', label: 'By Arrival' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setAttribution(mode.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    attribution === mode.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-200 hover:text-white'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Inline Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-200">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block" />
                Baseline Simulation
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400 inline-block" />
                Current Recovery Plan
              </span>
            </div>
            <span className="text-slate-300">
              {stats.impactedBaselineAirports}/{airports.length} airports with delay · Click a bar to inspect
            </span>
          </div>

          {/* Recharts Bar Chart */}
          <div className={compact ? 'h-[230px] w-full' : 'h-[280px] w-full'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: -12, bottom: compact ? 22 : 8 }}
                barGap={2}
                barCategoryGap={compact ? '18%' : '24%'}
                onClick={(state) => {
                  if (state && typeof state.activeLabel === 'string') {
                    setPinnedAirportCode((prev) =>
                      prev === state.activeLabel ? null : (state.activeLabel as string)
                    );
                  }
                }}
              >
                <defs>
                  <linearGradient id="baselineBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.98} />
                    <stop offset="100%" stopColor="#D97706" stopOpacity={0.88} />
                  </linearGradient>
                  <linearGradient id="recoveryBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34D399" stopOpacity={0.98} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={0.88} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226, 232, 240, 0.14)" />
                <XAxis
                  dataKey="code"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(226, 232, 240, 0.25)' }}
                  angle={compact ? -45 : 0}
                  textAnchor={compact ? 'end' : 'middle'}
                  height={compact ? 42 : 28}
                  tick={({ x, y, payload }) => {
                    const code = String(payload.value);
                    const isClosed = code === closedCode;
                    const isPinned = code === pinnedAirportCode;
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <text
                          x={0}
                          y={0}
                          dy={compact ? 10 : 14}
                          textAnchor={compact ? 'end' : 'middle'}
                          transform={compact ? 'rotate(-45)' : undefined}
                          fill={isClosed ? '#FDA4AF' : isPinned ? '#7DD3FC' : '#E2E8F0'}
                          fontSize={compact ? 10 : 11}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight={isClosed || isPinned ? 700 : 500}
                        >
                          {isClosed ? `${code}*` : code}
                        </text>
                      </g>
                    );
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#CBD5E1', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  tickFormatter={(v: number) => `${v}m`}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255, 255, 255, 0.08)' }}
                  content={<AirportTooltip attribution={attribution} hasRecovery={hasRecovery} />}
                />
                <Bar
                  dataKey="baselineDelay"
                  name="Baseline Simulation"
                  fill="url(#baselineBarGrad)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={compact ? 12 : 20}
                  isAnimationActive={false}
                  className="cursor-pointer"
                />
                <Bar
                  dataKey="recoveryDelay"
                  name="Current Recovery Plan"
                  fill="url(#recoveryBarGrad)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={compact ? 12 : 20}
                  isAnimationActive={false}
                  className="cursor-pointer"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {closedCode && (
            <div className="text-[11px] text-slate-300">
              <span className="font-mono font-semibold text-rose-300">{closedCode}*</span> marks the closed airport.
              Bars sum to exact deterministic total network delay ({attribution === 'origin' ? 'origin' : 'destination'} attribution).
            </div>
          )}

          {/* Pinned Airport Flight Breakdown Drawer */}
          {pinnedAirport && (
            <div className="mt-1 p-3 rounded-lg bg-slate-950/65 backdrop-blur-sm border border-white/15 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="font-semibold text-white">
                  <span className="font-mono">{pinnedAirport.code}</span> · {pinnedAirport.city}{' '}
                  <span className="font-normal text-slate-300">
                    ({attribution === 'origin' ? 'Departing' : 'Arriving'} flights:{' '}
                    <span className="font-mono tabular-nums text-white">
                      {pinnedAirport.baselineDelay}m → {pinnedAirport.recoveryDelay}m
                    </span>
                    )
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPinnedAirportCode(null)}
                  aria-label="Close airport breakdown"
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {pinnedFlights.length === 0 ? (
                <p className="text-[11px] text-slate-300">
                  All {attribution === 'origin' ? 'departures from' : 'arrivals into'} {pinnedAirport.code} are operating on time in both simulations.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                  {pinnedFlights.map(({ base, rec }) => {
                    const baseLabel = base.status === 'CANCELLED' ? 'CXL' : base.status === 'DELAYED' ? `+${base.arrDelayMin}m` : 'On Time';
                    const recLabel = rec.status === 'CANCELLED' ? 'CXL' : rec.status === 'DELAYED' ? `+${rec.arrDelayMin}m` : 'On Time';
                    const improved =
                      (base.status === 'CANCELLED' && rec.status !== 'CANCELLED') ||
                      (base.status === 'DELAYED' && rec.status === 'ON_TIME') ||
                      (base.status === 'DELAYED' && rec.status === 'DELAYED' && rec.arrDelayMin < base.arrDelayMin);
                    return (
                      <div
                        key={base.flight.id}
                        className="flex items-center justify-between gap-2 py-1 border-b border-white/10 font-mono tabular-nums"
                      >
                        <span className="text-slate-200 truncate">
                          <strong className="text-white">{base.flight.id}</strong> {base.flight.origin}→{base.flight.dest}
                        </span>
                        <span className={improved ? 'text-emerald-300 font-semibold shrink-0' : 'text-slate-300 shrink-0'}>
                          {baseLabel} → {recLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
