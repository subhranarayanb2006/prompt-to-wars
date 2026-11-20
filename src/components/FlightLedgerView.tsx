import React, { useEffect, useMemo, useState } from 'react';
import { Search, Upload, Download, ChevronDown, ChevronRight, Star, AlertTriangle } from 'lucide-react';
import { NetworkDataset, SimulatedFlight, SimulationResult } from '../types/network';
import { formatDuration, formatTime } from '../utils/time';
import { DatasetUploaderModal } from './DatasetUploaderModal';

interface FlightLedgerViewProps {
  dataset: NetworkDataset;
  result: SimulationResult;
  baseline: SimulationResult;
  watchlistIds: string[];
  watchlistFocusSignal: number;
  onToggleWatchlist: (flightId: string) => void;
  onClearWatchlist: () => void;
  onSelectFlight: (flightId: string) => void;
  onImportDataset: (newDataset: NetworkDataset) => void;
  onResetDefaultDataset: () => void;
  isCustomDataset: boolean;
}

type LedgerSubTab = 'flights' | 'connections' | 'crews' | 'spares';

export const FlightLedgerView: React.FC<FlightLedgerViewProps> = ({
  dataset,
  result,
  baseline,
  watchlistIds,
  watchlistFocusSignal,
  onToggleWatchlist,
  onClearWatchlist,
  onSelectFlight,
  onImportDataset,
  onResetDefaultDataset,
  isCustomDataset,
}) => {
  const [subTab, setSubTab] = useState<LedgerSubTab>('flights');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WATCHLIST' | 'DELAYED' | 'CANCELLED' | 'ON_TIME'>('ALL');
  const [airportFilter, setAirportFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  const watchedFlights = useMemo(
    () => result.flights.filter((sf) => watchlistSet.has(sf.flight.id)),
    [result.flights, watchlistSet]
  );

  const affectedWatchedFlights = useMemo(
    () => watchedFlights.filter((sf) => sf.status === 'DELAYED' || sf.status === 'CANCELLED'),
    [watchedFlights]
  );

  useEffect(() => {
    if (watchlistFocusSignal > 0) {
      setSubTab('flights');
      setStatusFilter('WATCHLIST');
    }
  }, [watchlistFocusSignal]);

  const filteredFlights = useMemo(() => {
    const q = search.trim().toLowerCase();
    return result.flights
      .filter((sf) => {
        if (statusFilter === 'WATCHLIST' && !watchlistSet.has(sf.flight.id)) return false;
        if (statusFilter !== 'ALL' && statusFilter !== 'WATCHLIST' && sf.status !== statusFilter) return false;
        if (airportFilter !== 'ALL' && sf.flight.origin !== airportFilter && sf.flight.dest !== airportFilter) {
          return false;
        }
        if (q) {
          const hay = `${sf.flight.id} ${sf.flight.origin} ${sf.flight.dest} ${sf.effectiveAircraftId} ${sf.effectiveCrewId} ${sf.causeSummary}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Put starred flights first when viewing watchlist or sort by severity
        const score = (f: SimulatedFlight) => (f.status === 'CANCELLED' ? 10000 : f.arrDelayMin);
        return score(b) - score(a) || a.flight.schedDep - b.flight.schedDep;
      });
  }, [result.flights, statusFilter, airportFilter, search, watchlistSet]);

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'domino-sky-dataset.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white/90 backdrop-blur-xl border border-white/70 rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.15)]">
      {/* Top Sub-Navigation & Dataset Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(
            [
              { id: 'flights', label: `Flights (${result.flights.length})` },
              { id: 'connections', label: `Connections (${result.connections.length})` },
              { id: 'crews', label: `Crews (${result.crews.length})` },
              { id: 'spares', label: `Spares & Reserves (${dataset.spares.length + dataset.standbyCrews.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {isCustomDataset && (
            <button
              type="button"
              onClick={onResetDefaultDataset}
              className="px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Restore Default Dataset
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadJson}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Dataset
          </button>
        </div>
      </div>

      {/* === TAB 1: FLIGHTS LEDGER === */}
      {subTab === 'flights' && (
        <>
          {/* Watchlist Active Alert Strip when starred flights are delayed or cancelled */}
          {affectedWatchedFlights.length > 0 && (
            <div className="px-5 py-2.5 border-b border-amber-200 bg-amber-50/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span className="font-semibold">
                  Watchlist Alert: {affectedWatchedFlights.length} of {watchedFlights.length} starred{' '}
                  {watchedFlights.length === 1 ? 'flight' : 'flights'} impacted
                </span>
                <span className="text-slate-400" aria-hidden="true">·</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
                  {affectedWatchedFlights.slice(0, 5).map((sf) => (
                    <button
                      key={sf.flight.id}
                      type="button"
                      onClick={() => onSelectFlight(sf.flight.id)}
                      className={`hover:underline cursor-pointer ${
                        sf.status === 'CANCELLED' ? 'text-rose-700 font-semibold' : 'text-amber-800 font-medium'
                      }`}
                    >
                      {sf.flight.id} ({sf.status === 'CANCELLED' ? 'Cancelled' : `+${sf.arrDelayMin}m`})
                    </button>
                  ))}
                  {affectedWatchedFlights.length > 5 && (
                    <span className="text-slate-500">+{affectedWatchedFlights.length - 5} more</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {statusFilter !== 'WATCHLIST' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('WATCHLIST')}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap cursor-pointer"
                  >
                    Filter Watchlist
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search flight, airport, tail, crew, or cause..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <select
                value={airportFilter}
                onChange={(e) => setAirportFilter(e.target.value)}
                aria-label="Filter by airport"
                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-800 font-mono focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">All 16 Airports</option>
                {dataset.airports.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.city}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {watchlistIds.length > 0 && statusFilter === 'WATCHLIST' && (
                <button
                  type="button"
                  onClick={onClearWatchlist}
                  className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  Clear Watchlist
                </button>
              )}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'ALL', label: `All (${result.summary.totalFlights})` },
                    {
                      id: 'WATCHLIST',
                      label:
                        affectedWatchedFlights.length > 0
                          ? `Watchlist (${watchedFlights.length} · ${affectedWatchedFlights.length} alert)`
                          : `Watchlist (${watchedFlights.length})`,
                    },
                    { id: 'DELAYED', label: `Delayed (${result.summary.delayedFlights})` },
                    { id: 'CANCELLED', label: `Cancelled (${result.summary.cancelledFlights})` },
                    { id: 'ON_TIME', label: `On Time (${result.summary.onTimeFlights})` },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                      statusFilter === f.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.id === 'WATCHLIST' && (
                      <Star
                        className={`w-3 h-3 ${
                          watchedFlights.length > 0 ? 'text-amber-500 fill-amber-400' : 'text-slate-400'
                        }`}
                      />
                    )}
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 pl-4 pr-1 w-9 text-center" title="Watchlist">
                    <span className="sr-only">Watch</span>
                  </th>
                  <th className="py-2.5 px-1 w-6"></th>
                  <th className="py-2.5 px-2">Flight</th>
                  <th className="py-2.5 px-2">Route</th>
                  <th className="py-2.5 px-2">Tail · Crew</th>
                  <th className="py-2.5 px-2">Scheduled</th>
                  <th className="py-2.5 px-2">Actual</th>
                  <th className="py-2.5 px-2 text-right">Delay</th>
                  <th className="py-2.5 px-3">Deterministic Cause</th>
                  <th className="py-2.5 pl-2 pr-5 text-right">Stranded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredFlights.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-500">
                      {statusFilter === 'WATCHLIST' && watchedFlights.length === 0 ? (
                        <div className="space-y-1.5">
                          <div className="font-medium text-slate-700">Your Watchlist is empty</div>
                          <p className="text-xs text-slate-500">
                            Star any flight in the ledger to monitor it and receive alerts when it becomes delayed or cancelled.
                          </p>
                          <button
                            type="button"
                            onClick={() => setStatusFilter('ALL')}
                            className="mt-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                          >
                            Browse All 70 Flights
                          </button>
                        </div>
                      ) : (
                        'No flights match your current filters.'
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredFlights.map((sf) => {
                    const isExpanded = expandedId === sf.flight.id;
                    const isWatched = watchlistSet.has(sf.flight.id);
                    const baseFlight = baseline.flightsById[sf.flight.id];
                    const stranded = sf.cancelledLocalPax + sf.brokenOutboundConnections;

                    return (
                      <React.Fragment key={sf.flight.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : sf.flight.id)}
                          className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                            isExpanded ? 'bg-slate-50/90' : isWatched ? 'bg-amber-50/25' : ''
                          }`}
                        >
                          <td className="py-2 pl-4 pr-1 text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleWatchlist(sf.flight.id);
                              }}
                              aria-label={
                                isWatched
                                  ? `Remove ${sf.flight.id} from Watchlist`
                                  : `Add ${sf.flight.id} to Watchlist`
                              }
                              title={isWatched ? 'Remove from Watchlist' : 'Star to add to Watchlist'}
                              className="p-1 rounded-md hover:bg-slate-200/70 transition-colors cursor-pointer inline-flex items-center justify-center"
                            >
                              <Star
                                className={`w-3.5 h-3.5 transition-colors ${
                                  isWatched
                                    ? 'text-amber-500 fill-amber-400'
                                    : 'text-slate-300 hover:text-slate-500'
                                }`}
                              />
                            </button>
                          </td>
                          <td className="py-2.5 px-1 text-slate-400">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </td>
                          <td className="py-2.5 px-2 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {sf.flight.id}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-slate-800 whitespace-nowrap">
                            {sf.flight.origin} → {sf.flight.dest}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-slate-600 whitespace-nowrap">
                            {sf.effectiveAircraftId} · {sf.effectiveCrewId}
                          </td>
                          <td className="py-2.5 px-2 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {formatTime(sf.flight.schedDep)}–{formatTime(sf.flight.schedArr)}
                          </td>
                          <td className="py-2.5 px-2 font-mono tabular-nums text-slate-900 whitespace-nowrap">
                            {sf.status === 'CANCELLED' ? (
                              <span className="text-rose-600 font-semibold">Cancelled</span>
                            ) : (
                              `${formatTime(sf.actualDep)}–${formatTime(sf.actualArr)}`
                            )}
                          </td>
                          <td className="py-2.5 px-2 font-mono tabular-nums text-right whitespace-nowrap">
                            {sf.status === 'CANCELLED' ? (
                              <span className="text-rose-600 font-semibold">CXL</span>
                            ) : sf.arrDelayMin > 0 ? (
                              <span className="text-amber-700 font-semibold">+{sf.arrDelayMin}m</span>
                            ) : (
                              <span className="text-emerald-700">On Time</span>
                            )}
                            {baseFlight &&
                              result.actions.length > 0 &&
                              (baseFlight.status !== sf.status || baseFlight.arrDelayMin !== sf.arrDelayMin) && (
                                <span className="ml-1.5 text-[10px] text-emerald-700">
                                  (was {baseFlight.status === 'CANCELLED' ? 'CXL' : `+${baseFlight.arrDelayMin}m`})
                                </span>
                              )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 max-w-xs truncate">
                            {sf.causeSummary}
                          </td>
                          <td className="py-2.5 pl-2 pr-5 font-mono tabular-nums text-right whitespace-nowrap">
                            {stranded > 0 ? (
                              <span className="text-rose-700 font-semibold">{stranded} pax</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={10} className="px-8 py-3.5 border-t border-slate-100">
                              <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="space-y-1.5 max-w-2xl">
                                  <div className="text-xs font-semibold text-slate-900">
                                    Deterministic Cause Trace for {sf.flight.id} ({sf.flight.origin}→{sf.flight.dest})
                                  </div>
                                  {sf.causeChain.length === 0 ? (
                                    <p className="text-xs text-slate-500">Operating cleanly on schedule.</p>
                                  ) : (
                                    <ol className="space-y-1 text-xs text-slate-700">
                                      {sf.causeChain.map((s) => (
                                        <li key={`${s.stepNumber}-${s.title}`}>
                                          <span className="font-mono font-semibold text-slate-500 mr-1.5">
                                            {s.stepNumber}.
                                          </span>
                                          <span className="font-medium text-slate-900">{s.title}:</span> {s.detail}
                                        </li>
                                      ))}
                                    </ol>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onToggleWatchlist(sf.flight.id);
                                    }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                                  >
                                    <Star
                                      className={`w-3.5 h-3.5 ${
                                        isWatched ? 'text-amber-500 fill-amber-400' : 'text-slate-400'
                                      }`}
                                    />
                                    {isWatched ? 'Starred' : 'Add to Watchlist'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectFlight(sf.flight.id);
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                                  >
                                    Trace on Network Map
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* === TAB 2: PASSENGER CONNECTIONS === */}
      {subTab === 'connections' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 pl-5 pr-2">ID</th>
                <th className="py-2.5 px-2">Hub</th>
                <th className="py-2.5 px-2">Feeder → Onward</th>
                <th className="py-2.5 px-2 text-right">Passengers</th>
                <th className="py-2.5 px-2 text-right">MCT</th>
                <th className="py-2.5 px-2 text-right">Available Window</th>
                <th className="py-2.5 pl-2 pr-5 text-right">Connection Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {[...result.connections]
                .sort((a, b) => b.strandedPassengers - a.strandedPassengers || a.connection.id.localeCompare(b.connection.id))
                .map((sc) => (
                  <tr key={sc.connection.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pl-5 pr-2 font-mono text-slate-500">{sc.connection.id}</td>
                    <td className="py-2.5 px-2 font-mono font-semibold text-slate-900">{sc.connection.airportCode}</td>
                    <td className="py-2.5 px-2 font-mono text-slate-800">
                      {sc.connection.fromFlightId} ({formatTime(sc.feederActualArr)}) → {sc.connection.toFlightId} ({formatTime(sc.onwardActualDep)})
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular-nums text-right text-slate-900 font-medium">
                      {sc.connection.passengers} pax
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular-nums text-right text-slate-500">
                      {sc.connection.mctMinutes}m
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular-nums text-right text-slate-900">
                      {sc.availableMinutes !== null ? `${sc.availableMinutes}m` : '—'}
                    </td>
                    <td className="py-2.5 pl-2 pr-5 text-right font-medium">
                      {sc.status === 'MISSED_DELAY' ? (
                        <span className="text-rose-600">
                          Missed (−{sc.shortfallMinutes}m · {sc.strandedPassengers} stranded)
                        </span>
                      ) : sc.status === 'MISSED_CANCELLED' ? (
                        <span className="text-rose-700">Broken (Flight Cancelled)</span>
                      ) : sc.status === 'SAVED_BY_HOLD' ? (
                        <span className="text-blue-700">Saved by Connection Hold</span>
                      ) : (
                        <span className="text-emerald-700">Intact</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* === TAB 3: CREW FDTL HOURS === */}
      {subTab === 'crews' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 pl-5 pr-2">Crew</th>
                <th className="py-2.5 px-2">Base</th>
                <th className="py-2.5 px-2">Assigned Legs</th>
                <th className="py-2.5 px-2">Report → Duty End</th>
                <th className="py-2.5 px-2 text-right">Duty Used / Legal FDTL</th>
                <th className="py-2.5 pl-2 pr-5 text-right">Legality Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {[...result.crews]
                .sort((a, b) => Number(b.breached) - Number(a.breached) || b.utilizationPct - a.utilizationPct)
                .map((sc) => (
                  <tr key={sc.crew.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pl-5 pr-2">
                      <span className="font-mono font-semibold text-slate-900 mr-2">{sc.crew.id}</span>
                      <span className="text-slate-600">{sc.crew.name}</span>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-slate-700">{sc.crew.base}</td>
                    <td className="py-2.5 px-2 font-mono text-slate-600">
                      {sc.flightIds.join(', ') || 'Relieved'}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular-nums text-slate-700">
                      {formatTime(sc.reportTime)} → {formatTime(sc.actualDutyEnd)}
                    </td>
                    <td className="py-2.5 px-2 font-mono tabular-nums text-right text-slate-900">
                      {formatDuration(sc.dutyMinutesUsed)} / {formatDuration(sc.maxDutyMinutes)} ({sc.utilizationPct}%)
                    </td>
                    <td className="py-2.5 pl-2 pr-5 text-right font-medium">
                      {sc.breached ? (
                        <span className="text-rose-600 font-semibold">
                          FDTL Breach ({sc.breachedFlightId} Cancelled)
                        </span>
                      ) : sc.utilizationPct >= 95 ? (
                        <span className="text-amber-700">Near Legal Limit</span>
                      ) : (
                        <span className="text-emerald-700">Legal</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* === TAB 4: SPARE AIRCRAFT & RESERVE CREWS === */}
      {subTab === 'spares' && (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 mb-3">
              Positioned Spare Aircraft ({dataset.spares.length})
            </h3>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {dataset.spares.map((sp) => {
                const deployedAction = result.actions.find((a) => a.spareId === sp.id);
                return (
                  <div key={sp.id} className="p-3.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono font-semibold text-slate-900">
                        {sp.id} · {sp.model} ({sp.capacity} seats)
                      </div>
                      <div className="text-slate-500 mt-0.5 font-mono tabular-nums">
                        Stationed at {sp.baseAirport} · Ready from {formatTime(sp.readyFrom)} · Fresh crew included
                      </div>
                    </div>
                    <span
                      className={`font-medium whitespace-nowrap ${
                        deployedAction ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {deployedAction ? `Deployed (${deployedAction.flightId})` : 'Available'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-900 mb-3">
              Standby Reserve Crews ({dataset.standbyCrews.length})
            </h3>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {dataset.standbyCrews.map((sc) => {
                const deployedAction = result.actions.find((a) => a.standbyCrewId === sc.id);
                return (
                  <div key={sc.id} className="p-3.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono font-semibold text-slate-900">
                        {sc.id} · {sc.name}
                      </div>
                      <div className="text-slate-500 mt-0.5 font-mono tabular-nums">
                        Base {sc.baseAirport} · Ready {formatTime(sc.readyFrom)} · Legal FDTL {formatDuration(sc.maxDutyMinutes)}
                      </div>
                    </div>
                    <span
                      className={`font-medium whitespace-nowrap ${
                        deployedAction ? 'text-emerald-700 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {deployedAction ? `Active (${deployedAction.flightId})` : 'On Standby'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Drag-and-Drop Custom Dataset JSON Uploader + Schema Validator */}
      <DatasetUploaderModal
        isOpen={showImportModal}
        currentDataset={dataset}
        onClose={() => setShowImportModal(false)}
        onImportDataset={onImportDataset}
      />
    </div>
  );
};
