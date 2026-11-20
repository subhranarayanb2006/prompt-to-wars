import React, { useMemo, useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Radar as RadarIcon } from 'lucide-react';
import { Airport, NetworkDataset, SimulationResult } from '../types/network';
import { formatTime } from '../utils/time';

interface RegionalDelayRadarProps {
  dataset: NetworkDataset;
  result: SimulationResult;
  baseline: SimulationResult;
  currentTimeMin: number;
  selectedAirportCode: string | null;
  hasRecovery: boolean;
  onSelectAirport: (code: string) => void;
}

type TimeScope = 'live' | 'full_day';

interface RadarAirportDatum {
  code: string;
  city: string;
  tier: Airport['tier'];
  liveAvgDelayMin: number;
  baselineAvgDelayMin: number;
  historicalAvgDelayMin: number;
  deviationMin: number;
  operatedFlights: number;
  delayedFlights: number;
  cancelledFlights: number;
  isClosed: boolean;
}

/**
 * Deterministic historical daily average delay baselines (in minutes) across Indian
 * domestic airports, calibrated by metro slot congestion, weather exposure, and tier.
 */
const HISTORICAL_DAILY_AVG_DELAY_MIN: Record<string, number> = {
  BOM: 18,
  DEL: 16,
  BLR: 14,
  HYD: 12,
  CCU: 13,
  MAA: 11,
  AMD: 10,
  PNQ: 12,
  COK: 9,
  GOI: 11,
  GOX: 10,
  JAI: 9,
  LKO: 10,
  GAU: 13,
  PAT: 12,
  BBI: 8,
  IXC: 9,
  NAG: 8,
  IDR: 9,
  SXR: 14,
  TRV: 8,
  VNS: 11,
};

function getHistoricalDailyAvg(airport: Airport): number {
  const known = HISTORICAL_DAILY_AVG_DELAY_MIN[airport.code];
  if (known !== undefined) return known;
  if (airport.tier === 'hub') return 15;
  if (airport.tier === 'regional') return 11;
  return 9;
}

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RadarAirportDatum }>;
  hasRecovery: boolean;
}

const RegionalRadarTooltip: React.FC<RadarTooltipProps> = ({ active, payload, hasRecovery }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const ratio = d.historicalAvgDelayMin > 0 ? d.liveAvgDelayMin / d.historicalAvgDelayMin : 0;

  return (
    <div className="bg-white/96 backdrop-blur-md border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[230px]">
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
        <div className="font-semibold text-slate-900">
          <span className="font-mono">{d.code}</span>
          <span className="text-slate-400 font-normal mx-1">·</span>
          <span>{d.city}</span>
        </div>
        <span className={`text-[11px] font-medium ${d.isClosed ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>
          {d.isClosed ? 'Closed' : d.tier}
        </span>
      </div>

      <div className="mt-2 space-y-1.5 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Real-Time Avg Delay</span>
          <span className={`font-semibold ${d.liveAvgDelayMin > d.historicalAvgDelayMin ? 'text-rose-700' : 'text-emerald-700'}`}>
            {d.liveAvgDelayMin.toFixed(1)}m
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Historical Daily Avg</span>
          <span className="font-semibold text-slate-700">{d.historicalAvgDelayMin.toFixed(1)}m</span>
        </div>

        {hasRecovery && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-600 font-sans">Unrecovered Baseline</span>
            <span className="font-semibold text-amber-700">{d.baselineAvgDelayMin.toFixed(1)}m</span>
          </div>
        )}

        <div className="pt-1.5 mt-1.5 border-t border-slate-100 flex items-center justify-between gap-4">
          <span className="text-slate-500 font-sans">vs Historical Norm</span>
          <span className={`font-semibold ${d.deviationMin > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {d.deviationMin > 0 ? `+${d.deviationMin.toFixed(1)}m` : `${d.deviationMin.toFixed(1)}m`}{' '}
            <span className="text-[10px] font-normal text-slate-500">({ratio.toFixed(1)}x)</span>
          </span>
        </div>

        <div className="text-[10px] font-sans text-slate-500 pt-0.5">
          {d.operatedFlights} active flights · {d.delayedFlights} delayed
          {d.cancelledFlights > 0 ? ` · ${d.cancelledFlights} cancelled` : ''}
        </div>
      </div>
    </div>
  );
};

export const RegionalDelayRadar: React.FC<RegionalDelayRadarProps> = ({
  dataset,
  result,
  baseline,
  currentTimeMin,
  selectedAirportCode,
  hasRecovery,
  onSelectAirport,
}) => {
  const [timeScope, setTimeScope] = useState<TimeScope>('live');
  const [showBaselineRing, setShowBaselineRing] = useState<boolean>(true);

  const closedCodes = useMemo(
    () => new Set(result.disruptions.map((d) => d.airportCode)),
    [result.disruptions]
  );

  const radarData: RadarAirportDatum[] = useMemo(() => {
    const computeAirportAvg = (sim: SimulationResult, code: string) => {
      let delaySum = 0;
      let operatedCount = 0;
      let delayedCount = 0;
      let cancelledCount = 0;

      for (const sf of sim.flights) {
        const isOrigin = sf.flight.origin === code;
        const isDest = sf.flight.dest === code;
        if (!isOrigin && !isDest) continue;

        if (timeScope === 'live') {
          // Include flights whose scheduled or actual touchpoint at this airport has occurred by currentTimeMin
          const schedTouch = isOrigin ? sf.flight.schedDep : sf.flight.schedArr;
          if (schedTouch > currentTimeMin) continue;
        }

        if (sf.status === 'CANCELLED') {
          cancelledCount += 1;
          continue;
        }

        const relevantDelay = isOrigin ? sf.depDelayMin : sf.arrDelayMin;
        operatedCount += 1;
        delaySum += relevantDelay;
        if (relevantDelay >= 15) {
          delayedCount += 1;
        }
      }

      const avg = operatedCount > 0 ? Number((delaySum / operatedCount).toFixed(1)) : 0;
      return { avg, operatedCount, delayedCount, cancelledCount };
    };

    // Order airports cleanly around the polar compass: Hubs -> Regionals -> Spokes
    const tierOrder: Record<Airport['tier'], number> = { hub: 0, regional: 1, spoke: 2 };
    const orderedAirports = [...dataset.airports].sort(
      (a, b) => tierOrder[a.tier] - tierOrder[b.tier] || a.code.localeCompare(b.code)
    );

    return orderedAirports.map((ap) => {
      const liveStats = computeAirportAvg(result, ap.code);
      const baseStats = computeAirportAvg(baseline, ap.code);
      const historicalAvgDelayMin = getHistoricalDailyAvg(ap);
      const deviationMin = Number((liveStats.avg - historicalAvgDelayMin).toFixed(1));

      return {
        code: ap.code,
        city: ap.city,
        tier: ap.tier,
        liveAvgDelayMin: liveStats.avg,
        baselineAvgDelayMin: baseStats.avg,
        historicalAvgDelayMin,
        deviationMin,
        operatedFlights: liveStats.operatedCount,
        delayedFlights: liveStats.delayedCount,
        cancelledFlights: liveStats.cancelledCount,
        isClosed: closedCodes.has(ap.code),
      };
    });
  }, [dataset.airports, result, baseline, timeScope, currentTimeMin, closedCodes]);

  const maxRadius = useMemo(() => {
    const rawMax = Math.max(
      30,
      ...radarData.map((d) =>
        Math.max(
          d.liveAvgDelayMin,
          d.historicalAvgDelayMin,
          hasRecovery && showBaselineRing ? d.baselineAvgDelayMin : 0
        )
      )
    );
    return Math.ceil(rawMax / 15) * 15;
  }, [radarData, hasRecovery, showBaselineRing]);

  const summaryStats = useMemo(() => {
    const count = Math.max(1, radarData.length);
    const networkLiveAvg = radarData.reduce((sum, d) => sum + d.liveAvgDelayMin, 0) / count;
    const networkHistAvg = radarData.reduce((sum, d) => sum + d.historicalAvgDelayMin, 0) / count;
    const aboveNormCount = radarData.filter((d) => d.liveAvgDelayMin > d.historicalAvgDelayMin).length;
    const rankedByDeviation = [...radarData].sort(
      (a, b) => b.deviationMin - a.deviationMin || b.liveAvgDelayMin - a.liveAvgDelayMin
    );
    const peakAirport = rankedByDeviation[0] ?? null;
    return {
      networkLiveAvg: Number(networkLiveAvg.toFixed(1)),
      networkHistAvg: Number(networkHistAvg.toFixed(1)),
      aboveNormCount,
      peakAirport,
      topAnomalies: rankedByDeviation.slice(0, 6),
    };
  }, [radarData]);

  return (
    <section
      aria-label="Regional Delay Radar across all 16 airports"
      className="bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200/80">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <RadarIcon className="w-4 h-4 text-blue-700 shrink-0" />
            Regional Delay Radar
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Real-time average delay intensity (minutes) across {dataset.airports.length} airports compared against historical daily norms
            {timeScope === 'live' ? ` through ${formatTime(currentTimeMin)}` : ' across full daily schedule'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasRecovery && (
            <button
              type="button"
              onClick={() => setShowBaselineRing((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                showBaselineRing
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
              }`}
            >
              {showBaselineRing ? 'Hide Unrecovered Ring' : 'Show Unrecovered Ring'}
            </button>
          )}

          <div
            className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg"
            role="tablist"
            aria-label="Radar time scope"
          >
            {(
              [
                { id: 'live', label: `Live (${formatTime(currentTimeMin)})` },
                { id: 'full_day', label: 'Full Day' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={timeScope === opt.id}
                onClick={() => setTimeScope(opt.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  timeScope === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: 7-col Polar Radar Chart + 5-col Regional Deviation Ledger */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Polar Radar Chart */}
        <div className="lg:col-span-7 flex flex-col">
          {/* Clean Inline Series Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 mb-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-600 inline-block" />
              Real-Time Avg Delay (min)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-500/75 border border-sky-700 inline-block" />
              Historical Daily Avg (min)
            </span>
            {hasRecovery && showBaselineRing && (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-amber-500 inline-block" />
                Unrecovered Baseline
              </span>
            )}
          </div>

          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="76%" data={radarData}>
                <PolarGrid stroke="#CBD5E1" strokeDasharray="3 3" />
                <PolarAngleAxis
                  dataKey="code"
                  tick={(props) => {
                    const { x, y, payload, textAnchor } = props;
                    const code = String(payload.value);
                    const isClosed = closedCodes.has(code);
                    const isSelected = selectedAirportCode === code;
                    return (
                      <text
                        x={x}
                        y={y}
                        textAnchor={textAnchor}
                        dominantBaseline="central"
                        onClick={() => onSelectAirport(code)}
                        className="cursor-pointer select-none"
                        fill={isClosed ? '#BE123C' : isSelected ? '#1D4ED8' : '#334155'}
                        fontSize={11}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight={isClosed || isSelected ? 700 : 600}
                      >
                        {isClosed ? `${code}*` : code}
                      </text>
                    );
                  }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, maxRadius]}
                  tickCount={4}
                  tickFormatter={(v: number) => `${v}m`}
                  tick={{
                    fill: '#64748B',
                    fontSize: 10,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                  axisLine={false}
                />
                <Tooltip content={<RegionalRadarTooltip hasRecovery={hasRecovery} />} />

                {/* Historical Daily Average Polygon */}
                <Radar
                  name="Historical Daily Avg"
                  dataKey="historicalAvgDelayMin"
                  stroke="#0284C7"
                  strokeWidth={1.75}
                  strokeDasharray="4 3"
                  fill="#38BDF8"
                  fillOpacity={0.16}
                  isAnimationActive={false}
                />

                {/* Optional Unrecovered Baseline Ring when Recovery Plan is Active */}
                {hasRecovery && showBaselineRing && (
                  <Radar
                    name="Unrecovered Baseline"
                    dataKey="baselineAvgDelayMin"
                    stroke="#D97706"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                    fill="#F59E0B"
                    fillOpacity={0.1}
                    isAnimationActive={false}
                  />
                )}

                {/* Real-Time Average Delay Intensity Polygon */}
                <Radar
                  name="Real-Time Avg Delay"
                  dataKey="liveAvgDelayMin"
                  stroke="#E11D48"
                  strokeWidth={2.2}
                  fill="#F43F5E"
                  fillOpacity={0.28}
                  dot={{ r: 3, fill: '#E11D48', stroke: '#FFFFFF', strokeWidth: 1 }}
                  activeDot={{ r: 5, fill: '#BE123C', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right 5 cols: Network Summary & Clickable Deviation Ranking */}
        <div className="lg:col-span-5 space-y-4">
          {/* 3-Metric Horizontal Summary Divider Row */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 border border-slate-200/90 rounded-lg bg-slate-50/70 py-2.5">
            <div className="px-3">
              <div className="text-[11px] text-slate-500">Network Avg</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-slate-900">
                {summaryStats.networkLiveAvg}m
              </div>
              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                norm {summaryStats.networkHistAvg}m
              </div>
            </div>

            <div className="px-3">
              <div className="text-[11px] text-slate-500">Above Norm</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-rose-700">
                {summaryStats.aboveNormCount}
                <span className="text-xs font-normal text-slate-400">/{radarData.length}</span>
              </div>
              <div className="text-[10px] text-slate-500">airports spiked</div>
            </div>

            <div className="px-3">
              <div className="text-[11px] text-slate-500">Peak Deviation</div>
              <div className="mt-0.5 font-mono tabular-nums text-sm font-bold text-slate-900">
                {summaryStats.peakAirport ? summaryStats.peakAirport.code : '—'}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-rose-700">
                {summaryStats.peakAirport
                  ? `${summaryStats.peakAirport.deviationMin > 0 ? '+' : ''}${summaryStats.peakAirport.deviationMin}m vs norm`
                  : 'Nominal'}
              </div>
            </div>
          </div>

          {/* Clickable Airport Deviation Table */}
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-slate-900">Highest Delay Intensity vs Historical Norm</span>
              <span className="text-[11px] text-slate-500">Click row to focus on map</span>
            </div>

            <div className="border border-slate-200/90 rounded-lg overflow-hidden bg-white">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2 px-3 font-medium">Airport</th>
                    <th className="py-2 px-3 font-medium text-right">Live Avg</th>
                    <th className="py-2 px-3 font-medium text-right">Hist Avg</th>
                    <th className="py-2 px-3 font-medium text-right">Deviation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {summaryStats.topAnomalies.map((row) => {
                    const isSelected = selectedAirportCode === row.code;
                    const devColor =
                      row.deviationMin > 15
                        ? 'text-rose-700 font-semibold'
                        : row.deviationMin > 0
                        ? 'text-amber-700 font-semibold'
                        : 'text-emerald-700 font-medium';

                    return (
                      <tr
                        key={row.code}
                        onClick={() => onSelectAirport(row.code)}
                        className={`transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/90' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2 px-3 font-sans">
                          <span className={`font-mono font-semibold ${row.isClosed ? 'text-rose-700' : 'text-slate-900'}`}>
                            {row.code}
                            {row.isClosed ? '*' : ''}
                          </span>
                          <span className="text-slate-400 mx-1">·</span>
                          <span className="text-slate-600">{row.city}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-slate-900">
                          {row.liveAvgDelayMin.toFixed(1)}m
                        </td>
                        <td className="py-2 px-3 text-right text-slate-500">
                          {row.historicalAvgDelayMin.toFixed(0)}m
                        </td>
                        <td className={`py-2 px-3 text-right ${devColor}`}>
                          {row.deviationMin > 0 ? `+${row.deviationMin.toFixed(1)}m` : `${row.deviationMin.toFixed(1)}m`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
