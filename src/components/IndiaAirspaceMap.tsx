import React, { useMemo, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  CloudLightning,
  CloudFog,
  AlertOctagon,
  Radio,
  Flame,
} from 'lucide-react';
import {
  Airport,
  DisruptionConfig,
  NetworkDataset,
  SimulatedFlight,
  SimulationResult,
} from '../types/network';
import { formatTime } from '../utils/time';

const MAP_BACKDROP_SRC = '/src/assets/images/chart_twilight_backdrop_1795152240004.jpg';

type HeatmapWindowMode = 'clock' | 'closure' | 'day';
type CongestionTier = 'Low' | 'Moderate' | 'High' | 'Severe';

interface AirportCongestionMetric {
  code: string;
  city: string;
  score: number; // 0 - 100 deterministic congestion index
  tier: CongestionTier;
  activeMovements: number;
  delayedMovements: number;
  holdingBacklog: number;
  cancelledMovements: number;
  delayMinutes: number;
  closureActiveInWindow: boolean;
}

function getCongestionTier(score: number): CongestionTier {
  if (score >= 75) return 'Severe';
  if (score >= 45) return 'High';
  if (score >= 20) return 'Moderate';
  return 'Low';
}

function getCongestionVisual(tier: CongestionTier) {
  switch (tier) {
    case 'Severe':
      return {
        gradientId: 'heatSevere',
        ringStroke: '#FB7185',
        textClass: 'text-rose-300',
        dotClass: 'bg-rose-500',
      };
    case 'High':
      return {
        gradientId: 'heatHigh',
        ringStroke: '#FB923C',
        textClass: 'text-orange-300',
        dotClass: 'bg-orange-500',
      };
    case 'Moderate':
      return {
        gradientId: 'heatModerate',
        ringStroke: '#FBBF24',
        textClass: 'text-amber-300',
        dotClass: 'bg-amber-400',
      };
    default:
      return {
        gradientId: 'heatLow',
        ringStroke: '#38BDF8',
        textClass: 'text-sky-300',
        dotClass: 'bg-sky-400',
      };
  }
}

interface IndiaAirspaceMapProps {
  dataset: NetworkDataset;
  result: SimulationResult;
  baseline: SimulationResult;
  currentTimeMin: number;
  isPlaying: boolean;
  playbackSpeed: number;
  selectedFlightId: string | null;
  selectedAirportCode: string | null;
  onSelectFlight: (flightId: string | null) => void;
  onSelectAirport: (code: string | null) => void;
  onTimeChange: (min: number) => void;
  onTogglePlay: () => void;
  onSetSpeed: (speed: 1 | 5 | 15) => void;
  onResetPlayback: () => void;
}

const VIEW_W = 760;
const VIEW_H = 660;
const LON_MIN = 67.2;
const LON_MAX = 96.8;
const LAT_MIN = 6.8;
const LAT_MAX = 34.8;

function project(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (VIEW_W - 60) + 30;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (VIEW_H - 50) + 25;
  return { x, y };
}

// Accurate stylized India mainland polygon coordinates [lat, lon]
const INDIA_OUTLINE_COORDS: [number, number][] = [
  [33.8, 74.2], [34.2, 76.8], [32.8, 78.6], [31.2, 78.9], [30.1, 80.3],
  [28.7, 80.1], [27.5, 81.9], [27.1, 84.8], [26.6, 87.9], [27.4, 88.8],
  [27.8, 91.8], [28.4, 94.8], [27.9, 96.2], [26.7, 95.3], [25.2, 94.4],
  [23.7, 93.3], [22.2, 92.9], [23.9, 91.6], [25.2, 90.0], [26.0, 89.2],
  [24.9, 88.4], [22.4, 88.9], [21.6, 87.8], [20.5, 86.9], [19.4, 85.1],
  [17.7, 83.3], [16.2, 81.1], [14.7, 80.1], [13.0, 80.3], [10.4, 79.8],
  [9.2, 79.1], [8.1, 77.5], [9.5, 76.3], [11.8, 75.4], [14.8, 74.1],
  [16.8, 73.3], [19.0, 72.8], [20.9, 72.8], [21.6, 72.2], [20.7, 70.9],
  [22.3, 69.0], [23.2, 68.7], [24.2, 69.5], [24.7, 71.1], [26.9, 70.1],
  [28.9, 72.5], [30.8, 74.3], [32.3, 74.6], [33.8, 74.2],
];

function buildIndiaPath(): string {
  return (
    INDIA_OUTLINE_COORDS.map(([lat, lon], i) => {
      const p = project(lat, lon);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(' ') + ' Z'
  );
}

function getArcGeometry(p1: { x: number; y: number }, p2: { x: number; y: number }, curveSign = 1) {
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy) || 1;
  const offset = Math.min(54, Math.max(16, dist * 0.16)) * curveSign;
  const cx = mx - (dy / dist) * offset;
  const cy = my + (dx / dist) * offset;
  return {
    path: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    cx,
    cy,
  };
}

function pointOnQuadBezier(
  p1: { x: number; y: number },
  c: { x: number; y: number },
  p2: { x: number; y: number },
  t: number
) {
  const mt = 1 - t;
  const x = mt * mt * p1.x + 2 * mt * t * c.x + t * t * p2.x;
  const y = mt * mt * p1.y + 2 * mt * t * c.y + t * t * p2.y;
  // Derivative for heading angle
  const dx = 2 * mt * (c.x - p1.x) + 2 * t * (p2.x - c.x);
  const dy = 2 * mt * (c.y - p1.y) + 2 * t * (p2.y - c.y);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { x, y, angle };
}

function getFlightStroke(sf: SimulatedFlight, isHighlighted: boolean, anyHighlight: boolean) {
  const opacity = anyHighlight ? (isHighlighted ? 0.96 : 0.12) : sf.status === 'ON_TIME' ? 0.24 : 0.82;
  if (sf.status === 'CANCELLED') {
    return { stroke: '#F43F5E', width: isHighlighted ? 2.8 : 1.9, dash: '5 4', opacity };
  }
  if (sf.isRecoveredByAction && sf.status === 'ON_TIME') {
    return { stroke: '#10B981', width: isHighlighted ? 2.8 : 2.0, dash: undefined, opacity: anyHighlight ? opacity : 0.88 };
  }
  if (sf.rootCause === 'CREW_CASCADE') {
    return { stroke: '#A855F7', width: isHighlighted ? 2.8 : 2.0, dash: '6 3', opacity };
  }
  if (sf.status === 'DELAYED') {
    return {
      stroke: sf.arrDelayMin >= 45 ? '#F97316' : '#F59E0B',
      width: isHighlighted ? 2.8 : 1.75,
      dash: undefined,
      opacity,
    };
  }
  return { stroke: '#60A5FA', width: isHighlighted ? 2.4 : 1.0, dash: undefined, opacity };
}

export const IndiaAirspaceMap: React.FC<IndiaAirspaceMapProps> = ({
  dataset,
  result,
  baseline,
  currentTimeMin,
  isPlaying,
  playbackSpeed,
  selectedFlightId,
  selectedAirportCode,
  onSelectFlight,
  onSelectAirport,
  onTimeChange,
  onTogglePlay,
  onSetSpeed,
  onResetPlayback,
}) => {
  const indiaPath = useMemo(() => buildIndiaPath(), []);

  const airportCoords = useMemo(() => {
    const map = new Map<string, { airport: Airport; x: number; y: number }>();
    for (const ap of dataset.airports) {
      const pt = project(ap.lat, ap.lon);
      map.set(ap.code, { airport: ap, x: pt.x, y: pt.y });
    }
    return map;
  }, [dataset.airports]);

  // Domino Lineage Tracer: strict backward causal chain for the selected flight
  const lineageInfo = useMemo(() => {
    const orderByFlightId = new Map<string, number>();
    const chainFlights: SimulatedFlight[] = [];
    let rootClosureLabel: string | null = null;

    if (!selectedFlightId) {
      return { orderByFlightId, chainFlights, rootClosureLabel };
    }
    const sf = result.flightsById[selectedFlightId];
    if (!sf) {
      return { orderByFlightId, chainFlights, rootClosureLabel };
    }

    const seen = new Set<string>();
    const addFlight = (fid: string | undefined) => {
      if (!fid || seen.has(fid)) return;
      const target = result.flightsById[fid];
      if (!target) return;
      seen.add(fid);
      chainFlights.push(target);
      orderByFlightId.set(fid, chainFlights.length);
    };

    for (const step of sf.causeChain) {
      if (step.type === 'CLOSURE' && !rootClosureLabel) {
        rootClosureLabel = step.title;
      }
      addFlight(step.flightId);
    }
    addFlight(sf.flight.id);

    return { orderByFlightId, chainFlights, rootClosureLabel };
  }, [selectedFlightId, result]);

  // Highlight causal lineage (plus aircraft rotation chain if flight is on time)
  const highlightedFlightIds = useMemo(() => {
    const set = new Set<string>();
    if (!selectedFlightId) return set;
    const sf = result.flightsById[selectedFlightId];
    if (!sf) return set;
    set.add(sf.flight.id);
    if (lineageInfo.chainFlights.length > 1) {
      for (const f of lineageInfo.chainFlights) set.add(f.flight.id);
    } else {
      for (const f of result.flights) {
        if (f.flight.aircraftId === sf.flight.aircraftId) {
          set.add(f.flight.id);
        }
      }
    }
    return set;
  }, [selectedFlightId, result, lineageInfo]);

  const airportStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        delayed: number;
        cancelled: number;
        stranded: number;
        brokenConnections: Array<{ from: string; to: string; pax: number; shortfall: number; cancelled: boolean }>;
      }
    >();
    for (const ap of dataset.airports) {
      stats.set(ap.code, { delayed: 0, cancelled: 0, stranded: 0, brokenConnections: [] });
    }
    for (const sf of result.flights) {
      const orig = stats.get(sf.flight.origin);
      if (orig) {
        if (sf.status === 'DELAYED') orig.delayed++;
        if (sf.status === 'CANCELLED') {
          orig.cancelled++;
          orig.stranded += sf.cancelledLocalPax;
        }
      }
    }
    for (const sc of result.connections) {
      if (sc.status === 'MISSED_DELAY' || sc.status === 'MISSED_CANCELLED') {
        const ap = stats.get(sc.connection.airportCode);
        if (ap) {
          if (sc.status === 'MISSED_DELAY') ap.stranded += sc.strandedPassengers;
          ap.brokenConnections.push({
            from: sc.connection.fromFlightId,
            to: sc.connection.toFlightId,
            pax: sc.connection.passengers,
            shortfall: sc.shortfallMinutes,
            cancelled: sc.status === 'MISSED_CANCELLED',
          });
        }
      }
    }
    return stats;
  }, [dataset.airports, result]);

  const disruption = result.disruption;
  const activeDisruptions = result.disruptions;

  // Determine flights visible/active on the map at currentTimeMin
  const flightRenderList = useMemo(() => {
    // Draw on-time first, delayed next, cancelled/highlighted on top
    return [...result.flights].sort((a, b) => {
      const rank = (f: SimulatedFlight) => {
        if (highlightedFlightIds.has(f.flight.id)) return 4;
        if (f.status === 'CANCELLED') return 3;
        if (f.isRecoveredByAction) return 2.5;
        if (f.status === 'DELAYED') return 2;
        return 1;
      };
      return rank(a) - rank(b);
    });
  }, [result.flights, highlightedFlightIds]);

  const activeInFlightCount = useMemo(() => {
    return result.flights.filter(
      (sf) =>
        sf.status !== 'CANCELLED' &&
        sf.actualDep !== null &&
        sf.actualArr !== null &&
        currentTimeMin >= sf.actualDep &&
        currentTimeMin <= sf.actualArr
    ).length;
  }, [result.flights, currentTimeMin]);

  const timeMinStart = 300; // 05:00
  const timeMinEnd = 1440; // 24:00

  const ClosureIcon =
    disruption?.reason === 'Dense Fog'
      ? CloudFog
      : disruption?.reason === 'Runway Closure'
      ? AlertOctagon
      : disruption?.reason === 'ATC Ground Stop'
      ? Radio
      : CloudLightning;

  const [mapBackdropFailed, setMapBackdropFailed] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [heatmapWindowMode, setHeatmapWindowMode] = useState<HeatmapWindowMode>('clock');
  const [hoveredAirportCode, setHoveredAirportCode] = useState<string | null>(null);

  // Active time window for the congestion heatmap overlay
  const activeHeatmapWindow = useMemo(() => {
    const effectiveMode: HeatmapWindowMode =
      heatmapWindowMode === 'closure' && !disruption ? 'clock' : heatmapWindowMode;

    if (effectiveMode === 'closure' && disruption) {
      return {
        mode: effectiveMode,
        startMin: disruption.startMin,
        endMin: disruption.endMin,
        label: `${formatTime(disruption.startMin)}–${formatTime(disruption.endMin)}`,
      };
    }
    if (effectiveMode === 'day') {
      return {
        mode: effectiveMode,
        startMin: timeMinStart,
        endMin: timeMinEnd,
        label: `${formatTime(timeMinStart)}–${formatTime(timeMinEnd)}`,
      };
    }
    const startMin = Math.max(timeMinStart, currentTimeMin - 60);
    const endMin = Math.min(timeMinEnd, currentTimeMin + 60);
    return {
      mode: effectiveMode,
      startMin,
      endMin,
      label: `${formatTime(startMin)}–${formatTime(endMin)}`,
    };
  }, [heatmapWindowMode, disruption, currentTimeMin, timeMinStart, timeMinEnd]);

  // Deterministic airport congestion computation for the selected simulation time window
  const airportCongestionMap = useMemo(() => {
    const { startMin, endMin } = activeHeatmapWindow;
    const map = new Map<string, AirportCongestionMetric>();

    const accum = new Map<
      string,
      {
        airport: Airport;
        activeMovements: number;
        delayedMovements: number;
        holdingBacklog: number;
        cancelledMovements: number;
        delayMinutes: number;
      }
    >();

    for (const ap of dataset.airports) {
      accum.set(ap.code, {
        airport: ap,
        activeMovements: 0,
        delayedMovements: 0,
        holdingBacklog: 0,
        cancelledMovements: 0,
        delayMinutes: 0,
      });
    }

    for (const sf of result.flights) {
      const origBucket = accum.get(sf.flight.origin);
      const destBucket = accum.get(sf.flight.dest);

      const depTime = sf.actualDep ?? sf.flight.schedDep;
      const arrTime = sf.actualArr ?? sf.flight.schedArr;

      if (origBucket) {
        const depInWindow = depTime >= startMin && depTime <= endMin;
        const schedInWindow = sf.flight.schedDep >= startMin && sf.flight.schedDep <= endMin;
        // Aircraft queued / ground-held at origin overlapping the window
        const isGroundHeldInWindow =
          sf.status === 'DELAYED' &&
          sf.actualDep !== null &&
          sf.flight.schedDep <= endMin &&
          sf.actualDep > startMin;

        if (depInWindow || schedInWindow) {
          origBucket.activeMovements += 1;
          if (sf.status === 'DELAYED') {
            origBucket.delayedMovements += 1;
            origBucket.delayMinutes += sf.arrDelayMin;
          } else if (sf.status === 'CANCELLED') {
            origBucket.cancelledMovements += 1;
          }
        }
        if (isGroundHeldInWindow) {
          origBucket.holdingBacklog += 1;
        }
      }

      if (destBucket) {
        const arrInWindow = arrTime >= startMin && arrTime <= endMin;
        if (arrInWindow) {
          destBucket.activeMovements += 1;
          if (sf.status === 'DELAYED') {
            destBucket.delayedMovements += 1;
            destBucket.delayMinutes += Math.round(sf.arrDelayMin * 0.6);
          } else if (sf.status === 'CANCELLED') {
            destBucket.cancelledMovements += 1;
          }
        }
      }
    }

    // Scale down raw weights slightly for Full Day view so cumulative traffic maps cleanly to 0–100
    const windowFactor = activeHeatmapWindow.mode === 'day' ? 0.42 : 1;

    for (const [code, b] of accum.entries()) {
      const closureActiveInWindow = activeDisruptions.some(
        (d) => d.airportCode === code && d.startMin <= endMin && d.endMin >= startMin
      );

      const rawScore =
        (b.activeMovements * 7 +
          b.delayedMovements * 14 +
          b.holdingBacklog * 16 +
          b.cancelledMovements * 22 +
          Math.min(45, b.delayMinutes * 0.18)) *
          windowFactor +
        (closureActiveInWindow ? 36 : 0);

      const score = Math.max(0, Math.min(100, Math.round(rawScore)));
      map.set(code, {
        code,
        city: b.airport.city,
        score,
        tier: getCongestionTier(score),
        activeMovements: b.activeMovements,
        delayedMovements: b.delayedMovements,
        holdingBacklog: b.holdingBacklog,
        cancelledMovements: b.cancelledMovements,
        delayMinutes: b.delayMinutes,
        closureActiveInWindow,
      });
    }

    return map;
  }, [dataset.airports, result.flights, disruption, activeHeatmapWindow]);

  const peakCongestedAirport = useMemo(() => {
    let best: AirportCongestionMetric | null = null;
    for (const metric of airportCongestionMap.values()) {
      if (!best || metric.score > best.score) best = metric;
    }
    return best;
  }, [airportCongestionMap]);

  const inspectedCongestion = useMemo(() => {
    const code = hoveredAirportCode ?? selectedAirportCode;
    return code ? airportCongestionMap.get(code) ?? null : null;
  }, [hoveredAirportCode, selectedAirportCode, airportCongestionMap]);

  return (
    <div className="flex flex-col bg-[#08101E]/95 backdrop-blur-md border border-white/15 rounded-xl overflow-hidden h-full shadow-[0_12px_36px_rgba(2,6,23,0.38)]">
      {/* Compact Map Header Bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/10 bg-[#0B1528]/90">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
            India Airspace Cascade Map
          </h2>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
            {formatTime(currentTimeMin)} IST
          </span>
          <span className="text-slate-600 hidden sm:inline" aria-hidden="true">·</span>
          <span className="text-xs text-slate-400 hidden sm:inline font-mono tabular-nums whitespace-nowrap">
            {activeInFlightCount} airborne
          </span>
        </div>

        {/* Clean Dual-Coded Legend + Heatmap Toggle */}
        <div className="flex items-center gap-3 text-[11px] text-slate-300 overflow-x-auto">
          <span className="hidden xl:flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-3 h-0.5 bg-blue-400/70 inline-block" /> On Time
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" /> Delayed
          </span>
          <span className="hidden md:flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-purple-400 inline-block" /> Crew
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-rose-500 inline-block" /> Cancelled
          </span>
          {result.actions.length > 0 && (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> Recovered
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            aria-pressed={showHeatmap}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showHeatmap
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30'
                : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
          >
            <Flame className={`w-3 h-3 ${showHeatmap ? 'text-amber-300' : 'text-slate-400'}`} />
            Heatmap {showHeatmap ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Main SVG Interactive Airspace Canvas */}
      <div className="relative flex-1 min-h-[460px] select-none bg-[#08101E] overflow-hidden">
        {!mapBackdropFailed && (
          <img
            src={MAP_BACKDROP_SRC}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setMapBackdropFailed(true)}
            className="pointer-events-none select-none absolute inset-0 w-full h-full object-cover object-center opacity-40"
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#070E1C]/78 via-[#0B1426]/65 to-[#070E1C]/86"
        />
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="relative z-10 w-full h-full max-h-[600px] block"
          onClick={() => {
            onSelectFlight(null);
            onSelectAirport(null);
          }}
        >
          <defs>
            <radialGradient id="stormGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.45" />
              <stop offset="55%" stopColor="#F43F5E" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#F43F5E" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="recoveredGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </radialGradient>
            {/* Airport Congestion Thermal Heatmap Gradients */}
            <radialGradient id="heatLow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.32" />
              <stop offset="55%" stopColor="#0EA5E9" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="heatModerate" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.52" />
              <stop offset="48%" stopColor="#F59E0B" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="heatHigh" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FB923C" stopOpacity="0.68" />
              <stop offset="45%" stopColor="#F97316" stopOpacity="0.34" />
              <stop offset="78%" stopColor="#F59E0B" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="heatSevere" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.82" />
              <stop offset="42%" stopColor="#E11D48" stopOpacity="0.45" />
              <stop offset="75%" stopColor="#F97316" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Subtle Airspace Lat/Lon Graticule */}
          {[10, 15, 20, 25, 30].map((lat) => {
            const p = project(lat, LON_MIN);
            return (
              <g key={`lat-${lat}`}>
                <line x1={20} y1={p.y} x2={VIEW_W - 20} y2={p.y} stroke="#162238" strokeWidth="1" />
                <text x={24} y={p.y - 4} fill="#334155" fontSize="9" fontFamily="IBM Plex Mono">
                  {lat}°N
                </text>
              </g>
            );
          })}
          {[70, 75, 80, 85, 90].map((lon) => {
            const p = project(LAT_MIN, lon);
            return (
              <g key={`lon-${lon}`}>
                <line x1={p.x} y1={18} x2={p.x} y2={VIEW_H - 18} stroke="#162238" strokeWidth="1" />
                <text x={p.x + 4} y={VIEW_H - 22} fill="#334155" fontSize="9" fontFamily="IBM Plex Mono">
                  {lon}°E
                </text>
              </g>
            );
          })}

          {/* India Mainland Silhouette */}
          <path
            d={indiaPath}
            fill="#111D33"
            stroke="#223656"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />

          {/* Airport Congestion Heatmap Overlay (Time-Window Reactive) */}
          {showHeatmap && (
            <g className="pointer-events-none" aria-label="Airport congestion heatmap overlay">
              {dataset.airports.map((ap) => {
                const pos = airportCoords.get(ap.code);
                const metric = airportCongestionMap.get(ap.code);
                if (!pos || !metric || metric.score === 0) return null;
                const vis = getCongestionVisual(metric.tier);
                const radius = 18 + (metric.score / 100) * 50;
                const contourRadius = Math.max(12, radius * 0.48);

                return (
                  <g key={`heat-${ap.code}`} transform={`translate(${pos.x}, ${pos.y})`}>
                    <circle
                      r={radius}
                      fill={`url(#${vis.gradientId})`}
                      className="mix-blend-screen"
                    />
                    {metric.score >= 45 && (
                      <circle
                        r={contourRadius}
                        fill="none"
                        stroke={vis.ringStroke}
                        strokeWidth={metric.score >= 75 ? 1.15 : 0.85}
                        strokeDasharray="2 3"
                        opacity={metric.score >= 75 ? 0.65 : 0.45}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Weather / Disruption Storm Cells Over All Closed Airports (Supports Rolling Dual Disruptions) */}
          {activeDisruptions.map((d, idx) => {
            const pos = airportCoords.get(d.airportCode);
            if (!pos) return null;
            const activeNow = currentTimeMin >= d.startMin && currentTimeMin <= d.endMin;
            return (
              <g key={`storm-${d.airportCode}-${idx}`} className="pointer-events-none">
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={activeNow ? 58 : 34}
                  fill="url(#stormGlow)"
                />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={activeNow ? 36 : 22}
                  fill="none"
                  stroke="#F43F5E"
                  strokeWidth={activeNow ? 1.5 : 1}
                  strokeDasharray="4 4"
                  opacity={activeNow ? 0.85 : 0.45}
                />
              </g>
            );
          })}

          {/* Flight Corridors (70 Flights) */}
          {flightRenderList.map((sf, idx) => {
            const orig = airportCoords.get(sf.flight.origin);
            const dest = airportCoords.get(sf.flight.dest);
            if (!orig || !dest) return null;

            // Show flights that have already started or are cancelled/highlighted so cascade visually unfolds over time!
            const eventStart = sf.actualDep ?? sf.flight.schedDep;
            const hasOccurred = currentTimeMin >= eventStart - 25 || highlightedFlightIds.has(sf.flight.id);
            const isHighlighted = highlightedFlightIds.has(sf.flight.id);
            const anyHighlight = highlightedFlightIds.size > 0;

            const curveSign = (idx % 2 === 0 ? 1 : -1) * (sf.flight.origin < sf.flight.dest ? 1 : -1);
            const geom = getArcGeometry(orig, dest, curveSign);
            const style = getFlightStroke(sf, isHighlighted, anyHighlight);

            const effectiveOpacity = hasOccurred ? style.opacity : anyHighlight ? 0.06 : 0.1;

            // Compute live flying aircraft position along the arc if airborne right now
            const isAirborne =
              sf.status !== 'CANCELLED' &&
              sf.actualDep !== null &&
              sf.actualArr !== null &&
              currentTimeMin >= sf.actualDep &&
              currentTimeMin <= sf.actualArr;

            const progress =
              isAirborne && sf.actualDep !== null && sf.actualArr !== null
                ? Math.max(0, Math.min(1, (currentTimeMin - sf.actualDep) / Math.max(1, sf.actualArr - sf.actualDep)))
                : null;

            const planePt =
              progress !== null
                ? pointOnQuadBezier(orig, { x: geom.cx, y: geom.cy }, dest, progress)
                : null;

            const midPt = pointOnQuadBezier(orig, { x: geom.cx, y: geom.cy }, dest, 0.5);

            return (
              <g
                key={sf.flight.id}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFlight(sf.flight.id === selectedFlightId ? null : sf.flight.id);
                }}
              >
                {/* Invisible wider hit target for easy clicking */}
                <path d={geom.path} fill="none" stroke="transparent" strokeWidth={10} />
                <path
                  d={geom.path}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                  opacity={effectiveOpacity}
                  strokeLinecap="round"
                />

                {/* Cancelled flight X marker at midpoint when revealed */}
                {sf.status === 'CANCELLED' && hasOccurred && (
                  <g transform={`translate(${midPt.x}, ${midPt.y})`}>
                    <circle r={7} fill="#0B1220" stroke="#F43F5E" strokeWidth={1.5} />
                    <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#F43F5E" strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                )}

                {/* Live Flying Aircraft Marker */}
                {planePt && (
                  <g transform={`translate(${planePt.x}, ${planePt.y}) rotate(${planePt.angle})`}>
                    <path
                      d="M 6 0 L -4 -4.5 L -2 0 L -4 4.5 Z"
                      fill={
                        sf.isRecoveredByAction && sf.status === 'ON_TIME'
                          ? '#34D399'
                          : sf.rootCause === 'CREW_CASCADE'
                          ? '#C084FC'
                          : sf.status === 'DELAYED'
                          ? '#FBBF24'
                          : '#93C5FD'
                      }
                      stroke="#0B1220"
                      strokeWidth="0.7"
                    />
                  </g>
                )}

                {/* Highlighted Domino Lineage Step & Leg Label */}
                {isHighlighted && (
                  <g transform={`translate(${midPt.x}, ${midPt.y - 12})`}>
                    <rect
                      x={lineageInfo.orderByFlightId.has(sf.flight.id) ? -42 : -28}
                      y={-10}
                      width={lineageInfo.orderByFlightId.has(sf.flight.id) ? 84 : 56}
                      height={17}
                      rx={4}
                      fill="#0F172A"
                      stroke={style.stroke}
                      strokeWidth={1.2}
                    />
                    <text
                      textAnchor="middle"
                      y={2}
                      fill="#F8FAFC"
                      fontSize="8.8"
                      fontWeight="600"
                      fontFamily="IBM Plex Mono"
                    >
                      {lineageInfo.orderByFlightId.has(sf.flight.id)
                        ? `#${lineageInfo.orderByFlightId.get(sf.flight.id)} ${sf.flight.id}${
                            sf.status === 'CANCELLED' ? ' CXL' : sf.arrDelayMin > 0 ? ` +${sf.arrDelayMin}m` : ''
                          }`
                        : sf.flight.id}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 16 Airport Nodes + Connection Hub Alert Badges */}
          {dataset.airports.map((ap) => {
            const pos = airportCoords.get(ap.code);
            if (!pos) return null;
            const st = airportStats.get(ap.code) ?? {
              delayed: 0,
              cancelled: 0,
              stranded: 0,
              brokenConnections: [],
            };
            const isClosed = activeDisruptions.some((d) => d.airportCode === ap.code);
            const isSelected = selectedAirportCode === ap.code;
            const isHub = ap.tier === 'hub';
            const hasSpare = dataset.spares.some((s) => s.baseAirport === ap.code);
            const showHubAlertBadge = isHub && (st.stranded > 0 || st.brokenConnections.length > 0);

            const nodeFill = isClosed
              ? '#F43F5E'
              : st.cancelled > 0
              ? '#FB7185'
              : st.delayed > 0
              ? '#F59E0B'
              : isHub
              ? '#38BDF8'
              : '#94A3B8';

            // Offset labels carefully to prevent overlaps in dense corridors
            const labelOffset: Record<string, { dx: number; dy: number; anchor: 'start' | 'end' | 'middle' }> = {
              BOM: { dx: -11, dy: 4, anchor: 'end' },
              PNQ: { dx: 10, dy: 6, anchor: 'start' },
              GOI: { dx: -10, dy: 5, anchor: 'end' },
              BLR: { dx: -11, dy: 4, anchor: 'end' },
              MAA: { dx: 11, dy: 5, anchor: 'start' },
              DEL: { dx: 11, dy: 2, anchor: 'start' },
              JAI: { dx: -10, dy: 4, anchor: 'end' },
              IXC: { dx: 10, dy: -2, anchor: 'start' },
              AMD: { dx: -10, dy: 3, anchor: 'end' },
              CCU: { dx: 10, dy: 4, anchor: 'start' },
              BBI: { dx: 10, dy: 6, anchor: 'start' },
              HYD: { dx: 11, dy: 4, anchor: 'start' },
              COK: { dx: -10, dy: 5, anchor: 'end' },
              LKO: { dx: 10, dy: 3, anchor: 'start' },
              PAT: { dx: 0, dy: -10, anchor: 'middle' },
              GAU: { dx: 0, dy: -10, anchor: 'middle' },
            };
            const off = labelOffset[ap.code] ?? { dx: 10, dy: 4, anchor: 'start' };

            return (
              <g
                key={ap.code}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredAirportCode(ap.code)}
                onMouseLeave={() => setHoveredAirportCode((prev) => (prev === ap.code ? null : prev))}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAirport(ap.code === selectedAirportCode ? null : ap.code);
                }}
              >
                {/* Hit area */}
                <circle r={18} fill="transparent" />

                {/* Selection ring */}
                {isSelected && (
                  <circle r={12} fill="none" stroke="#FFFFFF" strokeWidth={1.6} />
                )}

                {/* Spare hub outer ring */}
                {hasSpare && !isClosed && (
                  <circle r={8.5} fill="none" stroke="#38BDF8" strokeWidth={0.9} opacity={0.45} />
                )}

                <circle
                  r={isClosed ? 6.5 : isHub ? 5.2 : 3.8}
                  fill={nodeFill}
                  stroke="#0B1220"
                  strokeWidth={1.5}
                />

                {/* IATA Code Label */}
                <text
                  x={off.dx}
                  y={off.dy}
                  textAnchor={off.anchor}
                  fill={isClosed ? '#FDA4AF' : isSelected ? '#FFFFFF' : '#E2E8F0'}
                  fontSize={isHub || isClosed ? '11' : '10'}
                  fontWeight={isHub || isClosed ? '700' : '500'}
                  fontFamily="IBM Plex Mono"
                >
                  {ap.code}
                </text>

                {/* Impact micro-caption under IATA when disrupted */}
                {(isClosed || st.cancelled > 0 || st.delayed > 0) && (
                  <text
                    x={off.dx}
                    y={off.dy + 11}
                    textAnchor={off.anchor}
                    fill={isClosed || st.cancelled > 0 ? '#FB7185' : '#FBBF24'}
                    fontSize="8.5"
                    fontFamily="IBM Plex Mono"
                  >
                    {isClosed
                      ? 'CLOSED'
                      : st.cancelled > 0
                      ? `${st.cancelled} cxl · ${st.delayed} late`
                      : `${st.delayed} late`}
                  </text>
                )}

                {/* Connection Hub Alert Badge (BOM, DEL, BLR, HYD) showing Stranded Pax & Broken Connections */}
                {showHubAlertBadge && (
                  <g transform={`translate(${off.anchor === 'end' ? -12 : 12}, ${off.dy - 21})`}>
                    <rect
                      x={off.anchor === 'end' ? -96 : 0}
                      y={-1}
                      width={96}
                      height={15}
                      rx={4}
                      fill="#4C0519"
                      stroke="#FB7185"
                      strokeWidth={0.9}
                      opacity={0.94}
                    />
                    <text
                      x={off.anchor === 'end' ? -48 : 48}
                      y={9.5}
                      textAnchor="middle"
                      fill="#FFE4E6"
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="IBM Plex Mono"
                    >
                      {st.stranded} pax · {st.brokenConnections.length} conn
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Contextual Closure Callout Banner(s) (Top-Left inside Map, supports Rolling Multi-Airport Disruptions) */}
        {activeDisruptions.length > 0 && (
          <div className="absolute top-3 left-3 space-y-1.5 max-w-[280px] pointer-events-none z-20">
            {activeDisruptions.map((d, idx) => {
              const activeNow = currentTimeMin >= d.startMin && currentTimeMin <= d.endMin;
              return (
                <div
                  key={`${d.airportCode}-${idx}`}
                  className="bg-[#0F172A]/95 border border-rose-500/45 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-300">
                    <ClosureIcon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span className="truncate">
                      {activeDisruptions.length > 1 ? `#${idx + 1} ` : ''}
                      {d.airportCode} Closed · {d.reason}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-300">
                    {formatTime(d.startMin)}–{formatTime(d.endMin)} ({d.endMin - d.startMin}m)
                    {activeNow ? ' · Active now' : currentTimeMin > d.endMin ? ' · Reopened (cascade)' : ' · Upcoming'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active Recovery Overlay Badge (Top-Right inside Map) */}
        {result.actions.length > 0 && (
          <div className="absolute top-3 right-3 bg-[#0F172A]/95 border border-emerald-500/40 rounded-lg px-3 py-2 max-w-[260px] pointer-events-none">
            <div className="text-xs font-semibold text-emerald-300">
              Recovery Plan Active ({result.actions.length} {result.actions.length === 1 ? 'action' : 'actions'})
            </div>
            <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-300">
              Stranded: {baseline.summary.strandedPassengers} → {result.summary.strandedPassengers} pax · Cxl: {baseline.summary.cancelledFlights} → {result.summary.cancelledFlights}
            </div>
          </div>
        )}

        {/* Bottom-Left Congestion Heatmap Controls & Thermal Scale Legend */}
        {showHeatmap && (
          <div className="absolute bottom-3 left-3 z-20 bg-[#0B1528]/92 backdrop-blur-md border border-white/15 rounded-lg px-3 py-2.5 max-w-[295px] space-y-2 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-100 flex items-center gap-1.5 whitespace-nowrap">
                <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                Congestion Heatmap
              </span>
              <span className="text-[10px] font-mono tabular-nums text-sky-300 whitespace-nowrap">
                {activeHeatmapWindow.label} IST
              </span>
            </div>

            {/* Time Window Selector */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-900/90 border border-white/10 rounded-md">
              {(
                [
                  { id: 'clock', label: 'Clock ±60m', disabled: false },
                  { id: 'closure', label: 'Closure', disabled: !disruption },
                  { id: 'day', label: 'Full Day', disabled: false },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => setHeatmapWindowMode(opt.id)}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-colors whitespace-nowrap cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                    activeHeatmapWindow.mode === opt.id
                      ? 'bg-slate-100 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Dual-Coded Thermal Gradient Scale */}
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-amber-400 to-rose-500" />
              <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono tabular-nums">
                <span>Low</span>
                <span>Mod</span>
                <span>High</span>
                <span>Severe</span>
              </div>
            </div>

            {peakCongestedAirport && peakCongestedAirport.score > 0 && (
              <div className="pt-1.5 border-t border-white/10 flex items-center justify-between gap-2 text-[10px] text-slate-300 font-mono tabular-nums">
                <span className="truncate">
                  Peak:{' '}
                  <strong className={getCongestionVisual(peakCongestedAirport.tier).textClass}>
                    {peakCongestedAirport.code} {peakCongestedAirport.score}%
                  </strong>{' '}
                  ({peakCongestedAirport.tier})
                </span>
                <span className="text-slate-400 shrink-0">
                  {peakCongestedAirport.holdingBacklog > 0
                    ? `${peakCongestedAirport.holdingBacklog} held`
                    : `${peakCongestedAirport.activeMovements} mov`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Bottom-Right Live Airport Congestion & Broken Connections Inspector (on Hover or Selection) */}
        {showHeatmap && inspectedCongestion && (() => {
          const apStat = airportStats.get(inspectedCongestion.code);
          return (
            <div className="absolute bottom-3 right-3 z-20 bg-[#0B1528]/94 backdrop-blur-md border border-white/15 rounded-lg px-3 py-2.5 w-[245px] pointer-events-none shadow-lg">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white truncate">
                  <span className="font-mono">{inspectedCongestion.code}</span> · {inspectedCongestion.city}
                </span>
                <span
                  className={`font-mono tabular-nums font-bold shrink-0 ${
                    getCongestionVisual(inspectedCongestion.tier).textClass
                  }`}
                >
                  {inspectedCongestion.score}%
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                <span>Congestion Level</span>
                <span className={`font-semibold ${getCongestionVisual(inspectedCongestion.tier).textClass}`}>
                  {inspectedCongestion.tier}
                </span>
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-white/10 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-mono tabular-nums text-slate-300">
                <span>Movements: {inspectedCongestion.activeMovements}</span>
                <span>Delayed: {inspectedCongestion.delayedMovements}</span>
                <span>Queued/Held: {inspectedCongestion.holdingBacklog}</span>
                <span>Delay: {inspectedCongestion.delayMinutes}m</span>
              </div>
              {apStat && apStat.brokenConnections.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-white/10 space-y-0.5">
                  <div className="text-[10px] font-semibold text-rose-300">
                    Broken Connections ({apStat.stranded} stranded pax)
                  </div>
                  {apStat.brokenConnections.slice(0, 3).map((bc, idx) => (
                    <div key={idx} className="text-[10px] font-mono text-slate-200 flex justify-between gap-2">
                      <span>{bc.from} → {bc.to}</span>
                      <span className="text-rose-300">{bc.pax} pax</span>
                    </div>
                  ))}
                </div>
              )}
              {inspectedCongestion.closureActiveInWindow && (
                <div className="mt-1.5 text-[10px] font-semibold text-rose-300">
                  Ground-stop closure active in window
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Domino Lineage Tracer Strip (Shown whenever a flight with a causal chain is selected) */}
      {selectedFlightId && lineageInfo.chainFlights.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 bg-[#0A1324] flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-sky-300 uppercase tracking-wider text-[10px] mr-1">
            Domino Lineage:
          </span>
          {lineageInfo.rootClosureLabel && (
            <>
              <span className="font-mono text-rose-300 font-semibold">{lineageInfo.rootClosureLabel}</span>
              <span className="text-slate-500">→</span>
            </>
          )}
          {lineageInfo.chainFlights.map((cf, i) => (
            <React.Fragment key={cf.flight.id}>
              {i > 0 && <span className="text-slate-500">→</span>}
              <button
                type="button"
                onClick={() => onSelectFlight(cf.flight.id)}
                className={`px-1.5 py-0.5 rounded font-mono tabular-nums transition-colors cursor-pointer ${
                  cf.flight.id === selectedFlightId
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                {cf.flight.id} {cf.flight.origin}→{cf.flight.dest}{' '}
                <span className={cf.status === 'CANCELLED' ? 'text-rose-300' : 'text-amber-300'}>
                  ({cf.status === 'CANCELLED' ? 'CXL' : `+${cf.arrDelayMin}m`})
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Bottom Time-of-Day Cascade Playback Scrubber (05:00 to 24:00 with 1x / 5x / 15x speeds) */}
      <div className="px-4 py-3 border-t border-slate-800 bg-[#0E1729]">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0 cursor-pointer"
            aria-label={isPlaying ? 'Pause simulation playback' : 'Play simulation playback'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* Explicit 1x / 5x / 15x Time-Lapse Speed Selector */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-700 shrink-0">
            {([1, 5, 15] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onSetSpeed(spd)}
                className={`px-2 h-7 rounded-md text-[11px] font-mono tabular-nums font-semibold transition-colors cursor-pointer ${
                  playbackSpeed === spd
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onResetPlayback}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0 cursor-pointer"
            title="Reset clock to 05:00"
            aria-label="Reset simulation clock"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Scrubber Track with Multi-Closure Window Markers (05:00 to 24:00) */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="relative flex items-center">
              {/* Active Heatmap Window Band on Scrubber */}
              {showHeatmap && activeHeatmapWindow.mode !== 'day' && (
                <div
                  className="absolute h-2.5 bg-amber-400/25 border border-amber-400/45 rounded-full pointer-events-none"
                  style={{
                    left: `${Math.max(0, ((activeHeatmapWindow.startMin - timeMinStart) / (timeMinEnd - timeMinStart)) * 100)}%`,
                    width: `${Math.min(100, ((activeHeatmapWindow.endMin - activeHeatmapWindow.startMin) / (timeMinEnd - timeMinStart)) * 100)}%`,
                  }}
                />
              )}
              {activeDisruptions.map((d, idx) => (
                <div
                  key={`scrub-band-${d.airportCode}-${idx}`}
                  className="absolute h-2 bg-rose-500/55 rounded-full pointer-events-none"
                  style={{
                    left: `${Math.max(0, ((d.startMin - timeMinStart) / (timeMinEnd - timeMinStart)) * 100)}%`,
                    width: `${Math.min(100, ((d.endMin - d.startMin) / (timeMinEnd - timeMinStart)) * 100)}%`,
                  }}
                />
              ))}
              <input
                type="range"
                min={timeMinStart}
                max={timeMinEnd}
                step={5}
                value={currentTimeMin}
                onChange={(e) => onTimeChange(Number(e.target.value))}
                aria-label="Simulation time of day"
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 relative z-10"
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-400">
              <span>05:00</span>
              <span>09:30</span>
              <span>14:00</span>
              <span>19:00</span>
              <span>24:00</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
