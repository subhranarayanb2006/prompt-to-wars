import {
  CandidatePlanEvaluation,
  DisruptionConfig,
  NetworkDataset,
  RecoveryAction,
  SimulationResult,
} from '../types/network';
import { formatTime } from '../utils/time';
import { simulateNetwork } from './simulator';

function computeImpactScore(before: SimulationResult['summary'], after: SimulationResult['summary']): number {
  // Composite operational recovery score: prioritizes rescuing stranded passengers & cancellations,
  // then reducing total delay minutes and crew FDTL breaches.
  const paxSaved = before.strandedPassengers - after.strandedPassengers;
  const cancelsSaved = before.cancelledFlights - after.cancelledFlights;
  const delaySaved = before.totalDelayMinutes - after.totalDelayMinutes;
  const breachesSaved = before.crewBreachesCount - after.crewBreachesCount;
  const delayedSaved = before.delayedFlights - after.delayedFlights;

  return paxSaved * 14 + cancelsSaved * 450 + breachesSaved * 200 + delaySaved * 1.4 + delayedSaved * 25;
}

function evaluatePlan(
  dataset: NetworkDataset,
  disruption: DisruptionConfig,
  secondaryDisruption: DisruptionConfig | null,
  baseline: SimulationResult,
  planId: string,
  title: string,
  category: CandidatePlanEvaluation['category'],
  actions: RecoveryAction[]
): CandidatePlanEvaluation {
  const afterResult = simulateNetwork(dataset, disruption, actions, secondaryDisruption);
  const before = baseline.summary;
  const after = afterResult.summary;

  const rescuedFlightIds: string[] = [];
  const newlyCancelledFlightIds: string[] = [];

  for (const bf of baseline.flights) {
    const af = afterResult.flightsById[bf.flight.id];
    if (!af) continue;
    if (
      (bf.status === 'CANCELLED' && af.status !== 'CANCELLED') ||
      (bf.status === 'DELAYED' && af.status === 'ON_TIME') ||
      (bf.status === 'DELAYED' && af.status === 'DELAYED' && af.arrDelayMin <= bf.arrDelayMin - 15)
    ) {
      rescuedFlightIds.push(bf.flight.id);
    }
    if (bf.status !== 'CANCELLED' && af.status === 'CANCELLED') {
      newlyCancelledFlightIds.push(bf.flight.id);
    }
  }

  return {
    planId,
    title,
    category,
    actions,
    before,
    after,
    deltas: {
      delayedFlights: after.delayedFlights - before.delayedFlights,
      cancelledFlights: after.cancelledFlights - before.cancelledFlights,
      totalDelayMinutes: after.totalDelayMinutes - before.totalDelayMinutes,
      strandedPassengers: after.strandedPassengers - before.strandedPassengers,
      crewBreachesCount: after.crewBreachesCount - before.crewBreachesCount,
      estimatedCostInr: after.estimatedCostInr - before.estimatedCostInr,
    },
    rescuedFlightIds,
    newlyCancelledFlightIds,
    score: computeImpactScore(before, after),
  };
}

/**
 * Enumerates all valid deterministic single-action recovery levers for the current disrupted state.
 */
export function generateAvailableActions(
  dataset: NetworkDataset,
  disruption: DisruptionConfig | null,
  baseline: SimulationResult,
  secondaryDisruption: DisruptionConfig | null = null
): RecoveryAction[] {
  if (!disruption && !secondaryDisruption) return [];
  const activeDisruptions = [disruption, secondaryDisruption].filter(
    (d): d is DisruptionConfig => Boolean(d)
  );

  const actions: RecoveryAction[] = [];
  const seenIds = new Set<string>();

  const affectedFlights = baseline.flights.filter(
    (sf) => sf.status === 'DELAYED' || sf.status === 'CANCELLED'
  );

  // 1. DEPLOY_SPARE: Spare aircraft + fresh crew at its base airport taking over a delayed/cancelled flight
  for (const spare of dataset.spares) {
    for (const sf of affectedFlights) {
      if (sf.flight.origin !== spare.baseAirport) continue;
      if (spare.readyFrom > sf.flight.schedDep + 20) continue;
      // Don't waste a spare airframe on a flight whose departure is itself blocked inside an airport closure
      if (
        activeDisruptions.some(
          (d) =>
            sf.flight.origin === d.airportCode &&
            sf.flight.schedDep >= d.startMin &&
            sf.flight.schedDep < d.endMin
        )
      ) {
        continue;
      }
      const id = `spare_${spare.id}_${sf.flight.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      actions.push({
        id,
        type: 'DEPLOY_SPARE',
        label: `Deploy Spare ${spare.id} on ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest})`,
        detail: `Assign ${spare.model} spare ${spare.id} with fresh crew at ${spare.baseAirport} to take over ${sf.flight.id} and remaining ${sf.flight.aircraftId} tail legs.`,
        flightId: sf.flight.id,
        spareId: spare.id,
      });
    }
  }

  // 2. SWAP_CREW: Standby reserve crew at a hub relieving a crew that is delayed or breaching FDTL
  for (const sb of dataset.standbyCrews) {
    for (const sf of affectedFlights) {
      if (sf.flight.origin !== sb.baseAirport) continue;
      if (sb.readyFrom > sf.flight.schedDep + 60) continue;
      const crewSummary = baseline.crews.find((c) => c.crew.id === sf.flight.crewId);
      const isCrewRelevant =
        sf.rootCause === 'CREW_FDTL_CANCELLED' ||
        sf.rootCause === 'CREW_CASCADE' ||
        Boolean(crewSummary?.breached);
      if (!isCrewRelevant) continue;

      const id = `crew_${sb.id}_${sf.flight.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      actions.push({
        id,
        type: 'SWAP_CREW',
        label: `Swap Standby Crew ${sb.id} onto ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest})`,
        detail: `Dispatch ${sb.name} at ${sb.baseAirport} to relieve ${sf.flight.crewId} from ${sf.flight.id} onward, resetting legal FDTL hours.`,
        flightId: sf.flight.id,
        standbyCrewId: sb.id,
      });
    }
  }

  // 3. CANCEL_PAIR (Out-and-back shuttle loop) & CANCEL_FLIGHT (single leg)
  const flightsByAircraft = new Map<string, typeof baseline.flights>();
  for (const sf of baseline.flights) {
    const arr = flightsByAircraft.get(sf.flight.aircraftId) ?? [];
    arr.push(sf);
    flightsByAircraft.set(sf.flight.aircraftId, arr);
  }

  for (const [, chain] of flightsByAircraft.entries()) {
    for (let i = 0; i < chain.length; i++) {
      const sf = chain[i];
      if (sf.status !== 'DELAYED') continue;

      const next = i + 1 < chain.length ? chain[i + 1] : null;
      if (next && sf.flight.origin === next.flight.dest && sf.flight.dest === next.flight.origin) {
        const id = `cancel_pair_${sf.flight.id}_${next.flight.id}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          actions.push({
            id,
            type: 'CANCEL_PAIR',
            label: `Cancel Shuttle Loop ${sf.flight.id}/${next.flight.id} (${sf.flight.origin}↔${sf.flight.dest})`,
            detail: `Cancel round-trip ${sf.flight.id} & ${next.flight.id} (${sf.flight.passengers + next.flight.passengers} pax) so ${sf.flight.aircraftId} resets on schedule at ${sf.flight.origin}.`,
            flightId: sf.flight.id,
            secondFlightId: next.flight.id,
          });
        }
      }

      if (i < chain.length - 1) {
        const id = `cancel_single_${sf.flight.id}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          actions.push({
            id,
            type: 'CANCEL_FLIGHT',
            label: `Cancel ${sf.flight.id} (${sf.flight.origin}→${sf.flight.dest})`,
            detail: `Cancel ${sf.flight.id} (${sf.flight.passengers} pax) to relieve crew ${sf.flight.crewId} duty hours and trim downstream turn delay.`,
            flightId: sf.flight.id,
          });
        }
      }
    }
  }

  // 4. HOLD_CONNECTION: Hold an onward connecting flight (<= 35m) to save stranded connecting passengers
  for (const sc of baseline.connections) {
    if (sc.status !== 'MISSED_DELAY') continue;
    if (sc.shortfallMinutes <= 0 || sc.shortfallMinutes > 35) continue;
    const onward = baseline.flightsById[sc.connection.toFlightId];
    if (!onward || onward.status === 'CANCELLED') continue;

    const holdMin = sc.shortfallMinutes;
    const id = `hold_${onward.flight.id}_${sc.connection.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    actions.push({
      id,
      type: 'HOLD_CONNECTION',
      label: `Hold ${onward.flight.id} +${holdMin}m at ${sc.connection.airportCode} for ${sc.connection.fromFlightId}`,
      detail: `Delay ${onward.flight.id} departure to ${formatTime(onward.flight.schedDep + holdMin)} to protect ${sc.connection.passengers} connecting passengers from ${sc.connection.fromFlightId}.`,
      flightId: onward.flight.id,
      holdMinutes: holdMin,
      connectionId: sc.connection.id,
    });
  }

  return actions;
}

function actionsConflict(a: RecoveryAction, b: RecoveryAction): boolean {
  if (a.flightId === b.flightId) return true;
  if (a.spareId && b.spareId && a.spareId === b.spareId) return true;
  if (a.standbyCrewId && b.standbyCrewId && a.standbyCrewId === b.standbyCrewId) return true;
  if (a.secondFlightId && (a.secondFlightId === b.flightId || a.secondFlightId === b.secondFlightId)) return true;
  if (b.secondFlightId && b.secondFlightId === a.flightId) return true;
  return false;
}

/**
 * Deterministically evaluates and ranks the top recovery plans (single & combined)
 * so the AI Dispatcher ONLY selects from mathematically verified, exact Before/After plans.
 */
export function evaluateCandidateRecoveryPlans(
  dataset: NetworkDataset,
  disruption: DisruptionConfig | null,
  baseline: SimulationResult,
  secondaryDisruption: DisruptionConfig | null = null
): CandidatePlanEvaluation[] {
  if (!disruption) return [];
  if (baseline.summary.delayedFlights === 0 && baseline.summary.cancelledFlights === 0) return [];

  const available = generateAvailableActions(dataset, disruption, baseline, secondaryDisruption);
  const singleEvals: CandidatePlanEvaluation[] = [];

  for (const act of available) {
    const category: CandidatePlanEvaluation['category'] =
      act.type === 'DEPLOY_SPARE'
        ? 'SPARE_SWAP'
        : act.type === 'SWAP_CREW'
        ? 'CREW_SWAP'
        : act.type === 'HOLD_CONNECTION'
        ? 'CONNECTION_HOLD'
        : 'SELECTIVE_CANCEL';

    const ev = evaluatePlan(dataset, disruption, secondaryDisruption, baseline, act.id, act.label, category, [act]);
    if (
      ev.deltas.strandedPassengers < 0 ||
      ev.deltas.cancelledFlights < 0 ||
      ev.deltas.totalDelayMinutes <= -25
    ) {
      singleEvals.push(ev);
    }
  }

  singleEvals.sort((a, b) => b.score - a.score);

  const topSinglesForCombos = singleEvals.slice(0, 12);
  const combinedEvals: CandidatePlanEvaluation[] = [];
  const comboKeys = new Set<string>();

  for (let i = 0; i < topSinglesForCombos.length; i++) {
    for (let j = i + 1; j < topSinglesForCombos.length; j++) {
      const a1 = topSinglesForCombos[i].actions[0];
      const a2 = topSinglesForCombos[j].actions[0];
      if (actionsConflict(a1, a2)) continue;
      const f1 = dataset.flights.find((f) => f.id === a1.flightId);
      const f2 = dataset.flights.find((f) => f.id === a2.flightId);
      if (f1 && f2 && f1.aircraftId === f2.aircraftId) continue;

      const key = [a1.id, a2.id].sort().join('+');
      if (comboKeys.has(key)) continue;
      comboKeys.add(key);

      const ev = evaluatePlan(
        dataset,
        disruption,
        secondaryDisruption,
        baseline,
        `combo2_${i}_${j}`,
        `${a1.label} + ${a2.label}`,
        'COMBINED',
        [a1, a2]
      );
      if (ev.score > Math.max(topSinglesForCombos[i].score, topSinglesForCombos[j].score) + 40) {
        combinedEvals.push(ev);
      }
    }
  }

  combinedEvals.sort((a, b) => b.score - a.score);

  if (combinedEvals.length > 0 && baseline.summary.cancelledFlights >= 2) {
    const bestPair = combinedEvals[0];
    for (const candidate of topSinglesForCombos) {
      const a3 = candidate.actions[0];
      if (bestPair.actions.some((existing) => actionsConflict(existing, a3))) continue;
      const f3 = dataset.flights.find((f) => f.id === a3.flightId);
      const existingTails = new Set(
        bestPair.actions
          .map((a) => dataset.flights.find((f) => f.id === a.flightId)?.aircraftId)
          .filter(Boolean)
      );
      if (f3 && existingTails.has(f3.aircraftId)) continue;

      const ev3 = evaluatePlan(
        dataset,
        disruption,
        secondaryDisruption,
        baseline,
        `combo3_full_rescue`,
        `Coordinated 3-Step Network Recovery`,
        'COMBINED',
        [...bestPair.actions, a3]
      );
      if (ev3.score > bestPair.score + 50) {
        combinedEvals.unshift(ev3);
        break;
      }
    }
  }

  // Curate a diverse, non-duplicate slate of up to 7 deterministic plans across distinct operational strategies
  const curated: CandidatePlanEvaluation[] = [];
  const seenSignatures = new Set<string>();

  const pushUnique = (plan: CandidatePlanEvaluation | undefined) => {
    if (!plan) return;
    if (curated.some((c) => c.planId === plan.planId)) return;
    const sig = `${plan.category}|${plan.deltas.strandedPassengers}|${plan.deltas.cancelledFlights}|${plan.deltas.totalDelayMinutes}`;
    if (seenSignatures.has(sig)) return;
    seenSignatures.add(sig);
    curated.push(plan);
  };

  pushUnique(combinedEvals[0]);
  pushUnique(combinedEvals.find((e) => e.actions.some((a) => a.type === 'SWAP_CREW')));
  pushUnique(singleEvals.find((e) => e.category === 'SPARE_SWAP'));
  pushUnique(singleEvals.find((e) => e.category === 'CREW_SWAP'));
  pushUnique(singleEvals.find((e) => e.category === 'CONNECTION_HOLD'));
  pushUnique(singleEvals.find((e) => e.category === 'SELECTIVE_CANCEL'));

  for (const ev of [...combinedEvals, ...singleEvals]) {
    if (curated.length >= 7) break;
    pushUnique(ev);
  }

  return curated.sort((a, b) => b.score - a.score);
}
