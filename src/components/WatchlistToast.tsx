import React from 'react';
import { Star, AlertTriangle, ShieldAlert, CheckCircle2, X, ArrowRight } from 'lucide-react';
import { SimulatedFlight } from '../types/network';

export interface WatchlistToastEvent {
  id: string;
  tone: 'cancelled' | 'delayed' | 'recovered';
  title: string;
  flights: SimulatedFlight[];
}

interface WatchlistToastProps {
  event: WatchlistToastEvent | null;
  onDismiss: () => void;
  onInspectFlight: (flightId: string) => void;
  onViewWatchlist: () => void;
}

export const WatchlistToast: React.FC<WatchlistToastProps> = ({
  event,
  onDismiss,
  onInspectFlight,
  onViewWatchlist,
}) => {
  if (!event || event.flights.length === 0) return null;

  const isCancelled = event.tone === 'cancelled';
  const isRecovered = event.tone === 'recovered';

  const borderClass = isCancelled
    ? 'border-rose-300'
    : isRecovered
    ? 'border-emerald-300'
    : 'border-amber-300';

  const iconColor = isCancelled
    ? 'text-rose-600'
    : isRecovered
    ? 'text-emerald-600'
    : 'text-amber-600';

  const Icon = isCancelled ? ShieldAlert : isRecovered ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-40 w-[370px] max-w-[calc(100vw-2rem)] bg-white border ${borderClass} rounded-xl shadow-lg overflow-hidden`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5 min-w-0">
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
                <span className="truncate">{event.title}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {event.flights.length} starred {event.flights.length === 1 ? 'flight' : 'flights'} affected in current simulation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Dismiss watchlist notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100 max-h-40 overflow-y-auto">
          {event.flights.slice(0, 4).map((sf) => (
            <button
              key={sf.flight.id}
              type="button"
              onClick={() => onInspectFlight(sf.flight.id)}
              className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-50 px-1.5 -mx-1.5 rounded transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-xs font-mono font-semibold text-slate-900">
                  {sf.flight.id}{' '}
                  <span className="font-normal text-slate-600">
                    {sf.flight.origin}→{sf.flight.dest}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{sf.causeSummary}</div>
              </div>
              <span
                className={`text-[11px] font-mono tabular-nums font-semibold whitespace-nowrap shrink-0 ${
                  sf.status === 'CANCELLED'
                    ? 'text-rose-600'
                    : sf.status === 'DELAYED'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {sf.status === 'CANCELLED'
                  ? 'Cancelled'
                  : sf.status === 'DELAYED'
                  ? `+${sf.arrDelayMin}m`
                  : 'On Time'}
              </span>
            </button>
          ))}
          {event.flights.length > 4 && (
            <div className="pt-1.5 text-[11px] text-slate-500">
              +{event.flights.length - 4} more starred flights
            </div>
          )}
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={onViewWatchlist}
            className="flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
          >
            Open Watchlist in Ledger
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
