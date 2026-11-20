import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Activity, ShieldAlert, X, Filter } from 'lucide-react';
import { Airport, NetworkDataset, SimulationResult } from '../types/network';
import { simulateNetwork } from '../engine/simulator';
import { formatTime } from '../utils/time';

const CHART_BACKDROP_SRC = '/src/assets/images/chart_twilight_backdrop_1795152240004.jpg';

interface NetworkResilienceReportProps {
  compact?: boolean;
  dataset: NetworkDataset;
  baseline: SimulationResult;
  result: SimulationResult;
}

type AnalysisScope = 'network_stress' | 'active_scenario';
type TierFilter = 'ALL' | 'hub' | 'regional' | 'spoke';

interface FlightResiliencePoint {
  flightId: string;
  origin: string;
  dest: string;
  originCity: string;
  destCity: string;
  originTier: Airport['tier'];
  aircraftId: string;
  crewId: string;
  schedDep: number;
  schedArr: number;
  durationMin: number;
  passengers: number;
  // 16-airport stress metrics
  stressAffectedAirports: number;
  stressFdtlCancels: number;
  stressMeanDelayMin: number;
  stressSensitivityPct: number;
  // Active scenario metrics
  activeStatus: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
  activeDelayMin: number;
  activeSensitivityPct: number;
  activeCauseSummary: string;
  // Plotted Y value based on active scope
  yValue: number;
  hasFdtlRisk: boolean;
}

interface AirportResilienceSummary {
  airport: Airport;
  flightCount: number;
  avgDurationMin: number;
  avgSensitivityPct: number;
  maxSensitivityPct: number;
  fdtlRiskFlights: number;
  rating: 'Resilient' | 'Moderate' | 'Fragile';
}

function computeLinearRegression(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  if (n < 2) {
    return { r: 0, r2: 0, slope: 0, intercept: 0 };
  }
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const slope = denX > 0 ? num / denX : 0;
  const intercept = meanY - slope * meanX;
  const r = denX > 0 && denY > 0 ? num / Math.sqrt(denX * denY) : 0;
  return { r, r2: r * r, slope, intercept };
}

function describeCorrelation(r: number): string {
  const abs = Math.abs(r);
  const dir = r >= 0 ? 'positive' : 'negative';
  if (abs < 0.12) return 'Near-zero linear trend';
  if (abs < 0.3) return `Weak ${dir}`;
  if (abs < 0.55) return `Moderate ${dir}`;
  return `Strong ${dir}`;
}

function getTierColor(tier: Airport['tier'], hasFdtlRisk: boolean): string {
  if (hasFdtlRisk) return '#FB7185'; // Rose-400 for FDTL / cancellation risk
  if (tier === 'hub') return '#38BDF8'; // Sky-400
  if (tier === 'regional') return '#FBBF24'; // Amber-400
  return '#34D399'; // Emerald-400
}

export const NetworkResilienceReport: React.FC<NetworkResilienceReportProps> = ({
  compact = false,
  dataset,
  baseline,
  result,
}) => {
  const [scope, setScope] = useState<AnalysisScope>('network_stress');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [selectedAirportFilter, setSelectedAirportFilter] = useState<string | null>(null);
  const [hoveredFlight, setHoveredFlight] = useState<{
    point: FlightResiliencePoint;
    x: number;
    y: number;
  } | null>(null);
  const [pinnedFlightId, setPinnedFlightId] = useState<string | null>(null);
  const [backdropFailed, setBackdropFailed] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(compact ? 360 : 860);

  // Measure responsive container width for D3 scales
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const next = Math.max(280, Math.floor(el.getBoundingClientRect().width));
      setChartWidth(next);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const airportByCode = useMemo(
    () => new Map(dataset.airports.map((a) => [a.code, a])),
    [dataset.airports]
  );

  // Deterministic 16-airport stress test: run a standard 90m peak closure (08:00-09:30) at every airport
  const stressByFlightId = useMemo(() => {
    const stats = new Map<
      string,
      { affectedCount: number; fdtlCancels: number; totalEquivalentDelay: number }
    >();
    for (const f of dataset.flights) {
      stats.set(f.id, { affectedCount: 0, fdtlCancels: 0, totalEquivalentDelay: 0 });
    }

    for (const ap of dataset.airports) {
      const sim = simulateNetwork(
        dataset,
        {
          airportCode: ap.code,
          startMin: 480, // 08:00
          endMin: 570, // 09:30 (90m standardized stress)
          reason: 'Thunderstorm',
        },
        []
      );
      for (const sf of sim.flights) {
        const entry = stats.get(sf.flight.id);
        if (!entry) continue;
        if (sf.status === 'DELAYED') {
          entry.affectedCount += 1;
          entry.totalEquivalentDelay += sf.arrDelayMin;
        } else if (sf.status === 'CANCELLED') {
          entry.affectedCount += 1;
          entry.fdtlCancels += 1;
          // Cancellation severity equivalent so FDTL-cancelled flights register high delay sensitivity
          entry.totalEquivalentDelay += Math.max(sf.arrDelayMin, 90) + 45;
        }
      }
    }

    return stats;
  }, [dataset]);

  const effectiveScope: AnalysisScope = !baseline.disruption ? 'network_stress' : scope;

  // Build full 70-flight dataset for D3 scatter plot
  const allFlightPoints: FlightResiliencePoint[] = useMemo(() => {
    const airportCount = Math.max(1, dataset.airports.length);
    return dataset.flights.map((f) => {
      const durationMin = Math.max(1, f.schedArr - f.schedDep);
      const originAp = airportByCode.get(f.origin);
      const destAp = airportByCode.get(f.dest);
      const stress = stressByFlightId.get(f.id) ?? {
        affectedCount: 0,
        fdtlCancels: 0,
        totalEquivalentDelay: 0,
      };
      const stressMeanDelayMin = stress.totalEquivalentDelay / airportCount;
      const stressSensitivityPct = Number(((stressMeanDelayMin / durationMin) * 100).toFixed(1));

      const activeSf = result.flightsById[f.id];
      const activeStatus = activeSf?.status ?? 'ON_TIME';
      const activeDelayMin = activeSf?.arrDelayMin ?? 0;
      const activeEffectiveDelay =
        activeStatus === 'CANCELLED' ? Math.max(activeDelayMin, 90) + 45 : activeDelayMin;
      const activeSensitivityPct = Number(((activeEffectiveDelay / durationMin) * 100).toFixed(1));

      const yValue = effectiveScope === 'network_stress' ? stressSensitivityPct : activeSensitivityPct;
      const hasFdtlRisk =
        effectiveScope === 'network_stress' ? stress.fdtlCancels > 0 : activeStatus === 'CANCELLED';

      return {
        flightId: f.id,
        origin: f.origin,
        dest: f.dest,
        originCity: originAp?.city ?? f.origin,
        destCity: destAp?.city ?? f.dest,
        originTier: originAp?.tier ?? 'spoke',
        aircraftId: f.aircraftId,
        crewId: f.crewId,
        schedDep: f.schedDep,
        schedArr: f.schedArr,
        durationMin,
        passengers: f.passengers,
        stressAffectedAirports: stress.affectedCount,
        stressFdtlCancels: stress.fdtlCancels,
        stressMeanDelayMin: Number(stressMeanDelayMin.toFixed(1)),
        stressSensitivityPct,
        activeStatus,
        activeDelayMin,
        activeSensitivityPct,
        activeCauseSummary: activeSf?.causeSummary ?? 'Operating on schedule',
        yValue,
        hasFdtlRisk,
      };
    });
  }, [dataset.flights, dataset.airports.length, airportByCode, stressByFlightId, result.flightsById, effectiveScope]);

  const filteredPoints = useMemo(() => {
    return allFlightPoints.filter((pt) => {
      if (tierFilter !== 'ALL' && pt.originTier !== tierFilter) return false;
      if (selectedAirportFilter && pt.origin !== selectedAirportFilter && pt.dest !== selectedAirportFilter) {
        return false;
      }
      return true;
    });
  }, [allFlightPoints, tierFilter, selectedAirportFilter]);

  const regression = useMemo(() => {
    return computeLinearRegression(filteredPoints.map((p) => ({ x: p.durationMin, y: p.yValue })));
  }, [filteredPoints]);

  const summaryStats = useMemo(() => {
    if (filteredPoints.length === 0) {
      return {
        avgDuration: 0,
        avgSensitivity: 0,
        mostSensitive: null as FlightResiliencePoint | null,
        fdtlRiskCount: 0,
      };
    }
    const avgDuration = Math.round(
      filteredPoints.reduce((s, p) => s + p.durationMin, 0) / filteredPoints.length
    );
    const avgSensitivity = Number(
      (filteredPoints.reduce((s, p) => s + p.yValue, 0) / filteredPoints.length).toFixed(1)
    );
    const mostSensitive = [...filteredPoints].sort((a, b) => b.yValue - a.yValue)[0] ?? null;
    const fdtlRiskCount = filteredPoints.filter((p) => p.hasFdtlRisk).length;
    return { avgDuration, avgSensitivity, mostSensitive, fdtlRiskCount };
  }, [filteredPoints]);

  // 16-airport aggregated resilience ranking
  const airportSummaries: AirportResilienceSummary[] = useMemo(() => {
    return dataset.airports
      .map((ap) => {
        const touching = allFlightPoints.filter((p) => p.origin === ap.code || p.dest === ap.code);
        const flightCount = touching.length;
        const avgDurationMin =
          flightCount > 0
            ? Math.round(touching.reduce((s, p) => s + p.durationMin, 0) / flightCount)
            : 0;
        const avgSensitivityPct =
          flightCount > 0
            ? Number((touching.reduce((s, p) => s + p.yValue, 0) / flightCount).toFixed(1))
            : 0;
        const maxSensitivityPct =
          flightCount > 0 ? Math.max(...touching.map((p) => p.yValue)) : 0;
        const fdtlRiskFlights = touching.filter((p) => p.hasFdtlRisk).length;

        const fragileThreshold = effectiveScope === 'network_stress' ? 14 : 35;
        const moderateThreshold = effectiveScope === 'network_stress' ? 7 : 12;
        const rating: AirportResilienceSummary['rating'] =
          avgSensitivityPct >= fragileThreshold || fdtlRiskFlights >= 2
            ? 'Fragile'
            : avgSensitivityPct >= moderateThreshold || fdtlRiskFlights >= 1
            ? 'Moderate'
            : 'Resilient';

        return {
          airport: ap,
          flightCount,
          avgDurationMin,
          avgSensitivityPct,
          maxSensitivityPct,
          fdtlRiskFlights,
          rating,
        };
      })
      .sort((a, b) => b.avgSensitivityPct - a.avgSensitivityPct || a.airport.code.localeCompare(b.airport.code));
  }, [dataset.airports, allFlightPoints, effectiveScope]);

  const pinnedFlight = useMemo(
    () => (pinnedFlightId ? allFlightPoints.find((p) => p.flightId === pinnedFlightId) ?? null : null),
    [allFlightPoints, pinnedFlightId]
  );

  // Render D3 Scatter Plot
  const chartHeight = compact ? 270 : 350;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const margin = {
      top: 22,
      right: compact ? 18 : 28,
      bottom: 44,
      left: 52,
    };
    const innerW = Math.max(180, chartWidth - margin.left - margin.right);
    const innerH = Math.max(150, chartHeight - margin.top - margin.bottom);

    svg.attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xExtent = d3.extent(allFlightPoints, (d) => d.durationMin);
    const xMin = Math.max(30, Math.floor(((xExtent[0] ?? 50) - 10) / 10) * 10);
    const xMax = Math.ceil(((xExtent[1] ?? 180) + 12) / 10) * 10;

    const yMaxRaw = d3.max(filteredPoints.length > 0 ? filteredPoints : allFlightPoints, (d) => d.yValue) ?? 20;
    const yMax = Math.max(10, Math.ceil((yMaxRaw * 1.15) / 5) * 5);

    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, innerW]);
    const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);
    const rScale = d3
      .scaleSqrt()
      .domain(d3.extent(allFlightPoints, (d) => d.passengers) as [number, number])
      .range(compact ? [3.5, 6.5] : [4.2, 8.2]);

    // Horizontal & vertical subtle gridlines
    g.append('g')
      .attr('class', 'grid-y')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(5)
          .tickSize(-innerW)
          .tickFormat(() => '')
      )
      .call((sel) => sel.select('.domain').remove())
      .call((sel) =>
        sel
          .selectAll('line')
          .attr('stroke', 'rgba(226, 232, 240, 0.13)')
          .attr('stroke-dasharray', '3 3')
      );

    g.append('g')
      .attr('class', 'grid-x')
      .attr('transform', `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(compact ? 4 : 6)
          .tickSize(-innerH)
          .tickFormat(() => '')
      )
      .call((sel) => sel.select('.domain').remove())
      .call((sel) =>
        sel
          .selectAll('line')
          .attr('stroke', 'rgba(226, 232, 240, 0.08)')
          .attr('stroke-dasharray', '3 3')
      );

    // Median quadrant reference crosshairs
    if (filteredPoints.length >= 3) {
      const medX = d3.median(filteredPoints, (d) => d.durationMin) ?? (xMin + xMax) / 2;
      const medY = d3.median(filteredPoints, (d) => d.yValue) ?? yMax / 2;

      g.append('line')
        .attr('x1', xScale(medX))
        .attr('x2', xScale(medX))
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', 'rgba(148, 163, 184, 0.28)')
        .attr('stroke-dasharray', '4 4');

      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerW)
        .attr('y1', yScale(medY))
        .attr('y2', yScale(medY))
        .attr('stroke', 'rgba(148, 163, 184, 0.28)')
        .attr('stroke-dasharray', '4 4');

      if (!compact) {
        const quadTextStyle = (el: d3.Selection<SVGTextElement, unknown, null, undefined>) =>
          el
            .attr('fill', 'rgba(203, 213, 225, 0.45)')
            .attr('font-size', '9.5px')
            .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');

        quadTextStyle(g.append('text').attr('x', 6).attr('y', 12).text('Short-Haul · High Sensitivity'));
        quadTextStyle(
          g
            .append('text')
            .attr('x', innerW - 6)
            .attr('y', 12)
            .attr('text-anchor', 'end')
            .text('Long-Haul · High Sensitivity')
        );
        quadTextStyle(
          g
            .append('text')
            .attr('x', innerW - 6)
            .attr('y', innerH - 6)
            .attr('text-anchor', 'end')
            .text('Long-Haul · Resilient')
        );
      }
    }

    // OLS Linear Regression Trendline via D3 line generator
    if (filteredPoints.length >= 2) {
      const linePts: Array<[number, number]> = [xMin, xMax].map((x) => {
        const rawY = regression.slope * x + regression.intercept;
        const clampedY = Math.max(0, Math.min(yMax, rawY));
        return [xScale(x), yScale(clampedY)];
      });

      const trendLine = d3.line<[number, number]>();

      g.append('path')
        .datum(linePts)
        .attr('d', trendLine)
        .attr('fill', 'none')
        .attr('stroke', '#38BDF8')
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', 0.9);
    }

    // Axes
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(compact ? 4 : 6)
      .tickFormat((d) => `${d}m`);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(5)
      .tickFormat((d) => `${d}%`);

    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .call((sel) => sel.select('.domain').attr('stroke', 'rgba(226, 232, 240, 0.3)'))
      .call((sel) => sel.selectAll('.tick line').attr('stroke', 'rgba(226, 232, 240, 0.25)'))
      .call((sel) =>
        sel
          .selectAll('.tick text')
          .attr('fill', '#CBD5E1')
          .attr('font-size', '10.5px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      );

    g.append('g')
      .call(yAxis)
      .call((sel) => sel.select('.domain').attr('stroke', 'rgba(226, 232, 240, 0.3)'))
      .call((sel) => sel.selectAll('.tick line').attr('stroke', 'rgba(226, 232, 240, 0.25)'))
      .call((sel) =>
        sel
          .selectAll('.tick text')
          .attr('fill', '#CBD5E1')
          .attr('font-size', '10.5px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      );

    // Axis Titles
    g.append('text')
      .attr('x', innerW / 2)
      .attr('y', innerH + 34)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94A3B8')
      .attr('font-size', '11px')
      .text('Scheduled Flight Duration (minutes)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerH / 2)
      .attr('y', -38)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94A3B8')
      .attr('font-size', '11px')
      .text('Delay Sensitivity (% of block time)');

    // Scatter Plot Nodes (sorted so FDTL-risk & pinned flights render cleanly on top)
    const sortedForDraw = [...filteredPoints].sort((a, b) => {
      const rank = (p: FlightResiliencePoint) =>
        p.flightId === pinnedFlightId ? 3 : p.hasFdtlRisk ? 2 : 1;
      return rank(a) - rank(b);
    });

    const dots = g
      .selectAll<SVGCircleElement, FlightResiliencePoint>('circle.flight-dot')
      .data(sortedForDraw, (d) => d.flightId)
      .join('circle')
      .attr('class', 'flight-dot')
      .attr('cx', (d) => xScale(d.durationMin))
      .attr('cy', (d) => yScale(d.yValue))
      .attr('r', (d) => rScale(d.passengers) + (d.flightId === pinnedFlightId ? 2 : 0))
      .attr('fill', (d) => getTierColor(d.originTier, d.hasFdtlRisk))
      .attr('fill-opacity', (d) => (d.flightId === pinnedFlightId ? 1 : d.hasFdtlRisk ? 0.92 : 0.8))
      .attr('stroke', (d) =>
        d.flightId === pinnedFlightId ? '#FFFFFF' : d.hasFdtlRisk ? '#FFE4E6' : '#0B1220'
      )
      .attr('stroke-width', (d) => (d.flightId === pinnedFlightId ? 2.2 : d.hasFdtlRisk ? 1.4 : 1))
      .style('cursor', 'pointer');

    dots
      .on('mouseenter', function (_event, d) {
        d3.select(this)
          .attr('r', rScale(d.passengers) + 3)
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 2);
        setHoveredFlight({
          point: d,
          x: margin.left + xScale(d.durationMin),
          y: margin.top + yScale(d.yValue),
        });
      })
      .on('mouseleave', function (_event, d) {
        d3.select(this)
          .attr('r', rScale(d.passengers) + (d.flightId === pinnedFlightId ? 2 : 0))
          .attr('stroke', d.flightId === pinnedFlightId ? '#FFFFFF' : d.hasFdtlRisk ? '#FFE4E6' : '#0B1220')
          .attr('stroke-width', d.flightId === pinnedFlightId ? 2.2 : d.hasFdtlRisk ? 1.4 : 1);
        setHoveredFlight(null);
      })
      .on('click', (_event, d) => {
        setPinnedFlightId((prev) => (prev === d.flightId ? null : d.flightId));
      });

    // Label top 2 outlier flights in non-compact view for instant scannability
    if (!compact && filteredPoints.length > 0) {
      const outliers = [...filteredPoints]
        .sort((a, b) => b.yValue - a.yValue)
        .slice(0, 2)
        .filter((d) => d.yValue > 0);

      for (const out of outliers) {
        const cx = xScale(out.durationMin);
        const cy = yScale(out.yValue);
        const alignRight = cx > innerW - 95;
        g.append('text')
          .attr('x', alignRight ? cx - 10 : cx + 10)
          .attr('y', Math.max(12, cy + 3))
          .attr('text-anchor', alignRight ? 'end' : 'start')
          .attr('fill', '#F8FAFC')
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
          .attr('pointer-events', 'none')
          .text(`${out.flightId} (${out.origin}→${out.dest})`);
      }
    }
  }, [allFlightPoints, filteredPoints, regression, chartWidth, chartHeight, compact, pinnedFlightId]);

  const cardSurface = compact
    ? 'p-4'
    : 'bg-white/88 backdrop-blur-xl border border-white/70 rounded-xl p-5 shadow-[0_8px_30px_rgba(15,23,42,0.14)]';

  return (
    <div className={compact ? 'divide-y divide-slate-200' : 'space-y-5'}>
      {/* Report Header & Analytical Scope Controls */}
      <div className={cardSurface}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-blue-700 shrink-0" />
              Network Resilience Report ({dataset.airports.length} Airports · {dataset.flights.length} Flights)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              D3 correlation analysis comparing scheduled flight duration against deterministic delay sensitivity across the network.
            </p>
          </div>

          {/* Scope Toggle: 16-Airport Stress Test vs Active Scenario */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/75 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setScope('network_stress')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                effectiveScope === 'network_stress'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              16-Airport Stress Test
            </button>
            <button
              type="button"
              disabled={!baseline.disruption}
              onClick={() => setScope('active_scenario')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                effectiveScope === 'active_scenario'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active Scenario
            </button>
          </div>
        </div>

        {/* 4-Metric Statistical Correlation Strip */}
        <div
          className={`mt-4 pt-3.5 border-t border-slate-200/80 grid gap-3 text-xs ${
            compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'
          }`}
        >
          <div>
            <div className="text-[11px] text-slate-500">Pearson Correlation (r)</div>
            <div className="mt-0.5 font-mono tabular-nums font-bold text-slate-900 text-sm">
              {regression.r >= 0 ? '+' : ''}
              {regression.r.toFixed(2)}
              <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                R² = {regression.r2.toFixed(2)}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">{describeCorrelation(regression.r)}</div>
          </div>

          <div>
            <div className="text-[11px] text-slate-500">Duration Slope (per +30m)</div>
            <div className="mt-0.5 font-mono tabular-nums font-bold text-slate-900 text-sm">
              {regression.slope * 30 >= 0 ? '+' : ''}
              {(regression.slope * 30).toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Avg block {summaryStats.avgDuration}m · avg {summaryStats.avgSensitivity}%
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-500">Highest Sensitivity Flight</div>
            {summaryStats.mostSensitive ? (
              <>
                <div className="mt-0.5 font-mono tabular-nums font-bold text-rose-700 text-sm">
                  {summaryStats.mostSensitive.flightId} ({summaryStats.mostSensitive.yValue}%)
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                  {summaryStats.mostSensitive.origin}→{summaryStats.mostSensitive.dest} ·{' '}
                  {summaryStats.mostSensitive.durationMin}m block
                </div>
              </>
            ) : (
              <div className="mt-0.5 text-slate-400">—</div>
            )}
          </div>

          <div>
            <div className="text-[11px] text-slate-500">FDTL / Cancellation Risk</div>
            <div className="mt-0.5 font-mono tabular-nums font-bold text-slate-900 text-sm">
              {summaryStats.fdtlRiskCount}{' '}
              <span className="text-xs font-normal text-slate-500">/ {filteredPoints.length} flights</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {effectiveScope === 'network_stress'
                ? 'Breach duty in ≥1 hub closure'
                : 'Cancelled in current simulation'}
            </div>
          </div>
        </div>
      </div>

      {/* D3 Scatter Plot Card (Twilight Instrument Backdrop) */}
      <div className={compact ? 'p-3' : ''}>
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 text-slate-100 ${
            compact ? 'p-4 space-y-3' : 'p-5 space-y-3.5'
          }`}
        >
          {!backdropFailed && (
            <img
              src={CHART_BACKDROP_SRC}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              onError={() => setBackdropFailed(true)}
              className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover object-center opacity-50"
            />
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/65 to-slate-950/86"
          />

          <div className="relative z-10 space-y-3">
            {/* Scatter Plot Controls & Filters */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-white">
                  Flight Duration vs. Delay Sensitivity (D3 Scatter)
                </span>
                {selectedAirportFilter && (
                  <button
                    type="button"
                    onClick={() => setSelectedAirportFilter(null)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/40 text-sky-200 text-[11px] font-mono cursor-pointer hover:bg-sky-500/30"
                  >
                    <Filter className="w-3 h-3" />
                    {selectedAirportFilter} only
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-white/10 border border-white/15 rounded-lg">
                {(
                  [
                    { id: 'ALL', label: 'All Tiers' },
                    { id: 'hub', label: 'Hubs' },
                    { id: 'regional', label: 'Regional' },
                    { id: 'spoke', label: 'Spokes' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTierFilter(t.id)}
                    className={`px-2 py-1 text-[10.5px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                      tierFilter === t.id
                        ? 'bg-white text-slate-950'
                        : 'text-slate-200 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dual-Coded Legend */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-200">
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" /> Hub Origin
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Regional
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> Spoke
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 ring-1 ring-rose-200 inline-block" /> FDTL / CXL Risk
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-0 border-t-2 border-dashed border-sky-400 inline-block" /> OLS Trendline
                </span>
              </div>
              <span className="text-[10.5px] text-slate-300">Dot size = passenger load · Click dot to inspect</span>
            </div>

            {/* D3 SVG Plot Canvas + Dynamic Hover Tooltip */}
            <div ref={chartContainerRef} className="relative w-full">
              <svg
                ref={svgRef}
                className={`w-full block select-none ${compact ? 'h-[270px]' : 'h-[350px]'}`}
              />

              {hoveredFlight && (
                <div
                  className="pointer-events-none absolute z-30 bg-white/95 backdrop-blur-md border border-slate-200 rounded-lg shadow-xl px-3 py-2 text-xs text-slate-900 w-[235px]"
                  style={{
                    left: Math.min(Math.max(8, hoveredFlight.x + 14), Math.max(8, chartWidth - 245)),
                    top: Math.max(8, hoveredFlight.y - 108),
                  }}
                >
                  <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-100">
                    <span className="font-mono font-bold text-slate-900">
                      {hoveredFlight.point.flightId} · {hoveredFlight.point.origin}→{hoveredFlight.point.dest}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-blue-700">
                      {hoveredFlight.point.yValue}%
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1 text-[11px] font-mono tabular-nums text-slate-600">
                    <div className="flex justify-between">
                      <span className="font-sans">Block Duration</span>
                      <strong className="text-slate-900">{hoveredFlight.point.durationMin}m</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans">Passengers · Tail</span>
                      <span className="text-slate-800">
                        {hoveredFlight.point.passengers} pax · {hoveredFlight.point.aircraftId}
                      </span>
                    </div>
                    {effectiveScope === 'network_stress' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="font-sans">Vulnerable Closures</span>
                          <span className="text-slate-900">
                            {hoveredFlight.point.stressAffectedAirports} / {dataset.airports.length} airports
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans">Avg Stress Delay</span>
                          <span className="text-amber-700 font-semibold">
                            +{hoveredFlight.point.stressMeanDelayMin}m
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between">
                        <span className="font-sans">Active Sim Status</span>
                        <span
                          className={
                            hoveredFlight.point.activeStatus === 'CANCELLED'
                              ? 'text-rose-600 font-semibold'
                              : hoveredFlight.point.activeStatus === 'DELAYED'
                              ? 'text-amber-700 font-semibold'
                              : 'text-emerald-700 font-semibold'
                          }
                        >
                          {hoveredFlight.point.activeStatus === 'CANCELLED'
                            ? 'Cancelled'
                            : hoveredFlight.point.activeStatus === 'DELAYED'
                            ? `+${hoveredFlight.point.activeDelayMin}m`
                            : 'On Time'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-300 leading-relaxed">
              {effectiveScope === 'network_stress'
                ? 'Sensitivity = (mean cascade delay across all 16 standardized 90m airport closures ÷ scheduled flight duration) × 100.'
                : 'Sensitivity = (active simulation delay/cancellation equivalent ÷ scheduled flight duration) × 100.'}
            </div>

            {/* Pinned Flight Resilience Detail Drawer */}
            {pinnedFlight && (
              <div className="p-3 rounded-lg bg-slate-950/70 border border-white/15 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-white font-mono">
                    {pinnedFlight.flightId} · {pinnedFlight.origin} ({pinnedFlight.originCity}) →{' '}
                    {pinnedFlight.dest} ({pinnedFlight.destCity})
                  </div>
                  <button
                    type="button"
                    onClick={() => setPinnedFlightId(null)}
                    aria-label="Dismiss pinned flight"
                    className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-slate-300">
                  <span>
                    Sched {formatTime(pinnedFlight.schedDep)}–{formatTime(pinnedFlight.schedArr)} (
                    {pinnedFlight.durationMin}m)
                  </span>
                  <span>Aircraft {pinnedFlight.aircraftId}</span>
                  <span>Crew {pinnedFlight.crewId}</span>
                  <span>
                    Stress sensitivity <strong className="text-amber-300">{pinnedFlight.stressSensitivityPct}%</strong>
                  </span>
                  <span>
                    Hit by <strong className="text-white">{pinnedFlight.stressAffectedAirports}/16</strong> hub closures
                  </span>
                  {pinnedFlight.stressFdtlCancels > 0 && (
                    <span className="text-rose-300 font-semibold flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" />
                      FDTL cancel in {pinnedFlight.stressFdtlCancels}{' '}
                      {pinnedFlight.stressFdtlCancels === 1 ? 'closure' : 'closures'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-300">
                  Current simulation: <span className="text-white">{pinnedFlight.activeCauseSummary}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 16-Airport Resilience Ranking Grid */}
      <div className={cardSurface}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-900">
              16-Airport Delay Sensitivity Ranking
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Click any airport to filter the D3 scatter plot to flights serving that station.
            </p>
          </div>
          {selectedAirportFilter && (
            <button
              type="button"
              onClick={() => setSelectedAirportFilter(null)}
              className="text-[11px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
            >
              Show All 16 Airports
            </button>
          )}
        </div>

        <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {airportSummaries.map((item) => {
            const isSelected = selectedAirportFilter === item.airport.code;
            const ratingStyle =
              item.rating === 'Fragile'
                ? 'text-rose-700'
                : item.rating === 'Moderate'
                ? 'text-amber-700'
                : 'text-emerald-700';

            return (
              <button
                key={item.airport.code}
                type="button"
                onClick={() =>
                  setSelectedAirportFilter((prev) =>
                    prev === item.airport.code ? null : item.airport.code
                  )
                }
                className={`text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500/30'
                    : 'bg-white/80 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-xs">
                  <span className="font-mono font-bold text-slate-900">{item.airport.code}</span>
                  <span className={`text-[10.5px] font-semibold ${ratingStyle}`}>{item.rating}</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{item.airport.city}</div>
                <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10.5px] font-mono tabular-nums text-slate-700">
                  <span>{item.avgSensitivityPct}% sens</span>
                  <span className="text-slate-400">{item.avgDurationMin}m avg</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
