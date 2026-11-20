import { NetworkDataset, RecoveryAction } from '../types/network';

/**
 * Deterministic Airline Financial & Operational Cost Weights (INR).
 * Every cost figure displayed across KPIs, Before/After diffs, and AI briefings
 * is computed strictly from these fixed deterministic constants.
 */
export const COST_WEIGHTS_INR = {
  perStrandedPassenger: 8_500, // Hotel, meals, rebooking & DGCA compensation
  perCancelledFlight: 250_000, // ₹2.5L operational cancellation penalty, crew/slot overhead
  perDelayMinute: 1_200, // Fuel burn, gate overrun, ATC & crew overtime per delayed minute
  perStandbyCrewSwap: 35_000, // Reserve crew call-out allowance
} as const;

export interface DeterministicCostBreakdown {
  strandedPaxCostInr: number;
  cancellationCostInr: number;
  delayMinuteCostInr: number;
  recoveryResourceCostInr: number;
  totalCostInr: number;
}

export function computeDeterministicCostBreakdown(
  strandedPassengers: number,
  cancelledFlights: number,
  totalDelayMinutes: number,
  actions: RecoveryAction[],
  dataset: NetworkDataset
): DeterministicCostBreakdown {
  const spareById = new Map(dataset.spares.map((s) => [s.id, s]));

  const strandedPaxCostInr = strandedPassengers * COST_WEIGHTS_INR.perStrandedPassenger;
  const cancellationCostInr = cancelledFlights * COST_WEIGHTS_INR.perCancelledFlight;
  const delayMinuteCostInr = totalDelayMinutes * COST_WEIGHTS_INR.perDelayMinute;

  let recoveryResourceCostInr = 0;
  const chargedSpares = new Set<string>();
  const chargedCrews = new Set<string>();

  for (const act of actions) {
    if (act.type === 'DEPLOY_SPARE' && act.spareId && !chargedSpares.has(act.spareId)) {
      chargedSpares.add(act.spareId);
      const sp = spareById.get(act.spareId);
      recoveryResourceCostInr += Math.round((sp?.operatingCostInrLakhs ?? 2.8) * 100_000);
    } else if (act.type === 'SWAP_CREW' && act.standbyCrewId && !chargedCrews.has(act.standbyCrewId)) {
      chargedCrews.add(act.standbyCrewId);
      recoveryResourceCostInr += COST_WEIGHTS_INR.perStandbyCrewSwap;
    }
  }

  return {
    strandedPaxCostInr,
    cancellationCostInr,
    delayMinuteCostInr,
    recoveryResourceCostInr,
    totalCostInr:
      strandedPaxCostInr + cancellationCostInr + delayMinuteCostInr + recoveryResourceCostInr,
  };
}

/**
 * Formats INR amounts in concise Indian airline operations notation (₹ Cr / ₹ L / ₹ K).
 */
export function formatInrCompact(amountInr: number): string {
  const sign = amountInr < 0 ? '-' : '';
  const abs = Math.abs(amountInr);
  if (abs >= 10_000_000) {
    return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  }
  if (abs >= 100_000) {
    return `${sign}₹${(abs / 100_000).toFixed(2)}L`;
  }
  if (abs >= 1_000) {
    return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatInrDelta(deltaInr: number): string {
  if (deltaInr === 0) return '₹0';
  const prefix = deltaInr > 0 ? '+' : '-';
  return `${prefix}${formatInrCompact(Math.abs(deltaInr))}`;
}
