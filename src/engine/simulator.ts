import {
  CauseChainStep,
  DelayRootCause,
  DisruptionConfig,
  Flight,
  NetworkDataset,
  RecoveryAction,
  SimulatedConnection,
  SimulatedCrew,
  SimulatedFlight,
  SimulationResult,
  SimulationSummary,
} from '../types/network';
import { formatTime } from '../utils/time';
import { computeDeterministicCostBreakdown } from '../utils/costEstimator';

const CREW_TRANSFER_MIN = 35; // Minimum time for crew to switch between aircraft at a hub

interface AircraftRuntimeState {
  readyAt: number;
  lastActualArr: number | null;
  lastSchedArr: number | null;
  lastFlightId: string | null;
  lastAirport: string | null;
  lastCauseChain: CauseChainStep[];
}

interface CrewRuntimeState {
  reportTime: number | null;
  readyAt: number;
  lastFlightId: string | null;
  lastAircraftId: string | null;
  lastCauseChain: CauseChainStep[];
  maxDutyMinutes: number;
  debriefMinutes: number;
  breached: boolean;
  breachedFlightId: string | null;
  actualDutyEnd: number;
  scheduledDutyEnd: number;
  flightIds: string[];
}

/**
 * Deterministic Airline Network Delay Propagation Engine.
 * Evaluates all 70 flights in strict chronological order, propagating:
 *  1. Direct Airport Closure holds (departures & arrivals inside [startMin, endMin))
 *  2. Aircraft Turnaround Propagation (prevActualArr + minTurnaroundMin)
 *  3. Cross-Aircraft Crew Propagation (prevCrewArr + crewTransferMin)
 *  4. Legal Crew Duty Time Limit (FDTL) cancellations
 *  5. Deterministic Recovery Actions (Deploy Spare, Swap Crew, Cancel Flight / Pair, Hold Connection)
 *  6. Exact Passenger Connection breaks (MCT) and Stranded Passenger counts (zero double-counting)
 */
export function simulateNetwork(
  dataset: NetworkDataset,
  disruption: DisruptionConfig | null,
  actions: RecoveryAction[] = [],
  secondaryDisruption: DisruptionConfig | null = null
): SimulationResult {
  const activeDisruptions: DisruptionConfig[] = [
    ...(disruption ? [disruption] : []),
    ...(secondaryDisruption ? [secondaryDisruption] : []),
  ].sort((a, b) => a.startMin - b.startMin);

  const aircraftById = new Map(dataset.aircraft.map((a) => [a.id, a]));
  const crewById = new Map(dataset.crews.map((c) => [c.id, c]));
  const spareById = new Map(dataset.spares.map((s) => [s.id, s]));
  const standbyCrewById = new Map(dataset.standbyCrews.map((c) => [c.id, c]));

  // Sort flights chronologically by scheduled departure (ties broken by flight ID)
  const orderedFlights = [...dataset.flights].sort(
    (a, b) => a.schedDep - b.schedDep || a.id.localeCompare(b.id)
  );

  // Build aircraft flight sequences to handle spare takeover & cancel-pair continuity
  const aircraftFlightIds = new Map<string, string[]>();
  for (const f of orderedFlights) {
    const arr = aircraftFlightIds.get(f.aircraftId) ?? [];
    arr.push(f.id);
    aircraftFlightIds.set(f.aircraftId, arr);
  }

  // Parse recovery actions into fast lookup maps
  const cancelledFlightIds = new Set<string>();
  const cancelActionByFlight = new Map<string, RecoveryAction>();
  const spareTakeoverByFlight = new Map<string, { spareId: string; action: RecoveryAction; isEntryLeg: boolean }>();
  const crewSwapByFlight = new Map<string, { standbyCrewId: string; action: RecoveryAction; isEntryLeg: boolean }>();
  const holdByFlight = new Map<string, { holdMinutes: number; action: RecoveryAction }>();

  for (const action of actions) {
    if (action.type === 'CANCEL_FLIGHT') {
      cancelledFlightIds.add(action.flightId);
      cancelActionByFlight.set(action.flightId, action);
    } else if (action.type === 'CANCEL_PAIR') {
      cancelledFlightIds.add(action.flightId);
      cancelActionByFlight.set(action.flightId, action);
      if (action.secondFlightId) {
        cancelledFlightIds.add(action.secondFlightId);
        cancelActionByFlight.set(action.secondFlightId, action);
      }
    } else if (action.type === 'DEPLOY_SPARE' && action.spareId) {
      const targetFlight = orderedFlights.find((f) => f.id === action.flightId);
      if (targetFlight) {
        const chain = aircraftFlightIds.get(targetFlight.aircraftId) ?? [];
        const startIdx = chain.indexOf(targetFlight.id);
        if (startIdx >= 0) {
          // Spare aircraft + its fresh crew takes over from this leg through the rest of this tail's day
          for (let i = startIdx; i < chain.length; i++) {
            spareTakeoverByFlight.set(chain[i], {
              spareId: action.spareId,
              action,
              isEntryLeg: i === startIdx,
            });
          }
        }
      }
    } else if (action.type === 'SWAP_CREW' && action.standbyCrewId) {
      const targetFlight = orderedFlights.find((f) => f.id === action.flightId);
      if (targetFlight) {
        // Reserve crew takes over this flight and all subsequent flights originally assigned to that crew
        const crewFlights = orderedFlights.filter((f) => f.crewId === targetFlight.crewId);
        const startIdx = crewFlights.findIndex((f) => f.id === targetFlight.id);
        if (startIdx >= 0) {
          for (let i = startIdx; i < crewFlights.length; i++) {
            crewSwapByFlight.set(crewFlights[i].id, {
              standbyCrewId: action.standbyCrewId,
              action,
              isEntryLeg: i === startIdx,
            });
          }
        }
      }
    } else if (action.type === 'HOLD_CONNECTION' && action.holdMinutes) {
      const existing = holdByFlight.get(action.flightId);
      if (!existing || action.holdMinutes > existing.holdMinutes) {
        holdByFlight.set(action.flightId, { holdMinutes: action.holdMinutes, action });
      }
    }
  }

  // Track scheduled crew first/last times for reporting
  const crewSchedFirstDep = new Map<string, number>();
  const crewSchedLastArr = new Map<string, number>();
  for (const f of orderedFlights) {
    if (!crewSchedFirstDep.has(f.crewId)) crewSchedFirstDep.set(f.crewId, f.schedDep);
    crewSchedLastArr.set(f.crewId, Math.max(crewSchedLastArr.get(f.crewId) ?? 0, f.schedArr));
  }

  // Runtime states per effective aircraft and effective crew
  const aircraftState = new Map<string, AircraftRuntimeState>();
  const crewState = new Map<string, CrewRuntimeState>();

  for (const ac of dataset.aircraft) {
    aircraftState.set(ac.id, {
      readyAt: 0,
      lastActualArr: null,
      lastSchedArr: null,
      lastFlightId: null,
      lastAirport: ac.homeBase,
      lastCauseChain: [],
    });
  }
  for (const sp of dataset.spares) {
    aircraftState.set(sp.id, {
      readyAt: sp.readyFrom,
      lastActualArr: null,
      lastSchedArr: null,
      lastFlightId: null,
      lastAirport: sp.baseAirport,
      lastCauseChain: [],
    });
    // Fresh crew bundled with spare aircraft
    crewState.set(`CREW-${sp.id}`, {
      reportTime: null,
      readyAt: sp.readyFrom,
      lastFlightId: null,
      lastAircraftId: sp.id,
      lastCauseChain: [],
      maxDutyMinutes: 660,
      debriefMinutes: 15,
      breached: false,
      breachedFlightId: null,
      actualDutyEnd: sp.readyFrom,
      scheduledDutyEnd: sp.readyFrom,
      flightIds: [],
    });
  }

  for (const c of dataset.crews) {
    const firstDep = crewSchedFirstDep.get(c.id) ?? 360;
    const lastArr = crewSchedLastArr.get(c.id) ?? 1080;
    crewState.set(c.id, {
      reportTime: firstDep - c.reportBeforeFirstFlightMin,
      readyAt: 0,
      lastFlightId: null,
      lastAircraftId: null,
      lastCauseChain: [],
      maxDutyMinutes: c.maxDutyMinutes,
      debriefMinutes: c.debriefAfterLastFlightMin,
      breached: false,
      breachedFlightId: null,
      actualDutyEnd: lastArr + c.debriefAfterLastFlightMin,
      scheduledDutyEnd: lastArr + c.debriefAfterLastFlightMin,
      flightIds: [],
    });
  }

  for (const sc of dataset.standbyCrews) {
    crewState.set(sc.id, {
      reportTime: null,
      readyAt: sc.readyFrom,
      lastFlightId: null,
      lastAircraftId: null,
      lastCauseChain: [],
      maxDutyMinutes: sc.maxDutyMinutes,
      debriefMinutes: 15,
      breached: false,
      breachedFlightId: null,
      actualDutyEnd: sc.readyFrom,
      scheduledDutyEnd: sc.readyFrom,
      flightIds: [],
    });
  }

  const simulatedFlights: SimulatedFlight[] = [];
  const flightsById: Record<string, SimulatedFlight> = {};

  for (const flight of orderedFlights) {
    const duration = flight.schedArr - flight.schedDep;
    const origAircraft = aircraftById.get(flight.aircraftId);
    const minTurn = origAircraft?.minTurnaroundMin ?? 35;

    const spareOverride = spareTakeoverByFlight.get(flight.id);
    const crewSwapOverride = crewSwapByFlight.get(flight.id);
    const holdOverride = holdByFlight.get(flight.id);

    const effectiveAircraftId = spareOverride ? spareOverride.spareId : flight.aircraftId;
    const effectiveCrewId = spareOverride
      ? `CREW-${spareOverride.spareId}`
      : crewSwapOverride
      ? crewSwapOverride.standbyCrewId
      : flight.crewId;

    const acState = aircraftState.get(effectiveAircraftId)!;
    const crState = crewState.get(effectiveCrewId)!;

    // 1. Check if explicitly cancelled as a recovery action
    if (cancelledFlightIds.has(flight.id)) {
      const cancelAct = cancelActionByFlight.get(flight.id)!;
      const chain: CauseChainStep[] = [
        {
          stepNumber: 1,
          type: 'RECOVERY',
          flightId: flight.id,
          airportCode: flight.origin,
          title: `Cancelled by Recovery Plan (${flight.id})`,
          detail: `${cancelAct.label} — frees ${effectiveAircraftId} and relieves crew ${effectiveCrewId} duty hours for downstream legs.`,
        },
      ];

      // Note: If a single flight is cancelled (not a symmetric out-and-back pair) and the aircraft still needs
      // to operate a downstream flight from flight.dest, an empty positioning ferry still requires flight time
      // (but skips 30m boarding/deplaning). If it's a CANCEL_PAIR (A->B and B->A), the aircraft stays cleanly at A!
      if (cancelAct.type === 'CANCEL_FLIGHT') {
        const tailChain = aircraftFlightIds.get(flight.aircraftId) ?? [];
        const idx = tailChain.indexOf(flight.id);
        const nextFlightId = idx >= 0 && idx + 1 < tailChain.length ? tailChain[idx + 1] : null;
        const nextFlight = nextFlightId ? orderedFlights.find((f) => f.id === nextFlightId) : null;
        if (nextFlight && nextFlight.origin === flight.dest && !cancelledFlightIds.has(nextFlight.id)) {
          // Empty ferry moves aircraft faster (saves 25 min ground turn & boarding)
          const ferryDep = Math.max(flight.schedDep, acState.readyAt);
          const ferryArr = ferryDep + Math.max(30, duration - 10);
          acState.readyAt = ferryArr + 15; // minimal ferry turn
          acState.lastAirport = flight.dest;
        }
      }

      const simFlight: SimulatedFlight = {
        flight,
        status: 'CANCELLED',
        actualDep: null,
        actualArr: null,
        depDelayMin: 0,
        arrDelayMin: 0,
        effectiveAircraftId,
        effectiveCrewId,
        rootCause: 'RECOVERY_CANCELLED',
        causeSummary: `Cancelled via recovery plan (${cancelAct.label})`,
        causeChain: chain,
        upstreamFlightId: null,
        isDirectClosureHit: false,
        isRecoveredByAction: true,
        crewDutyAtArrivalMin: null,
        crewMaxDutyMin: crState.maxDutyMinutes,
        crewBreachMin: 0,
        cancelledLocalPax: flight.passengers,
        brokenOutboundConnections: 0,
        prevAircraftFlightId: acState.lastFlightId,
        scheduledTurnaroundMin: null,
        actualTurnaroundMin: null,
        turnaroundCompressedMin: 0,
      };
      simulatedFlights.push(simFlight);
      flightsById[flight.id] = simFlight;
      continue;
    }

    // 2. Compute earliest feasible departure from: Scheduled, Aircraft Ready, Crew Ready, Hold Action
    let earliestDep = flight.schedDep;
    let depDriver: 'SCHEDULE' | 'AIRCRAFT' | 'CREW' | 'SPARE_READY' | 'HOLD' = 'SCHEDULE';
    let upstreamFlightId: string | null = null;
    let baseChain: CauseChainStep[] = [];

    // Aircraft availability constraint
    const aircraftReady = acState.lastFlightId
      ? acState.readyAt
      : spareOverride
      ? spareById.get(spareOverride.spareId)?.readyFrom ?? 0
      : 0;

    if (aircraftReady > earliestDep) {
      earliestDep = aircraftReady;
      depDriver = spareOverride && spareOverride.isEntryLeg ? 'SPARE_READY' : 'AIRCRAFT';
      upstreamFlightId = acState.lastFlightId;
      baseChain = [...acState.lastCauseChain];
    }

    // Crew availability constraint (including cross-aircraft transfer buffer)
    const crewTransferBuffer =
      crState.lastFlightId && crState.lastAircraftId !== effectiveAircraftId ? CREW_TRANSFER_MIN : 0;
    const crewReady = crState.lastFlightId ? crState.readyAt + crewTransferBuffer : crState.readyAt;

    if (crewReady > earliestDep) {
      earliestDep = crewReady;
      depDriver = 'CREW';
      upstreamFlightId = crState.lastFlightId;
      baseChain = [...crState.lastCauseChain];
    }

    // Optional recovery action: Hold flight for connecting passengers
    let appliedHoldMin = 0;
    if (holdOverride && holdOverride.holdMinutes > 0) {
      const heldTarget = flight.schedDep + holdOverride.holdMinutes;
      if (heldTarget > earliestDep) {
        appliedHoldMin = heldTarget - earliestDep;
        earliestDep = heldTarget;
        depDriver = 'HOLD';
      }
    }

    // 3. Apply Airport Closure(s) at Origin (Departure Hold) & Destination (Arrival Ground Delay Program)
    let isDirectClosureHit = false;
    let depClosureHoldMin = 0;
    let depClosureHit: DisruptionConfig | null = null;
    for (const d of activeDisruptions) {
      if (
        flight.origin === d.airportCode &&
        earliestDep >= d.startMin &&
        earliestDep < d.endMin
      ) {
        depClosureHoldMin += d.endMin - earliestDep;
        earliestDep = d.endMin;
        depClosureHit = d;
        isDirectClosureHit = true;
      }
    }

    // Compute projected arrival & apply Airport Closure(s) at Destination (Arrival Airborne/Ground Hold)
    let projectedArr = earliestDep + duration;
    let arrClosureHoldMin = 0;
    let arrClosureHit: DisruptionConfig | null = null;
    for (const d of activeDisruptions) {
      if (
        flight.dest === d.airportCode &&
        projectedArr >= d.startMin &&
        projectedArr < d.endMin
      ) {
        const hold = d.endMin - projectedArr;
        arrClosureHoldMin += hold;
        projectedArr = d.endMin;
        earliestDep += hold;
        arrClosureHit = d;
        isDirectClosureHit = true;
      }
    }

    // Re-check origin closure once in case destination GDP pushed departure into a second origin closure window
    for (const d of activeDisruptions) {
      if (
        flight.origin === d.airportCode &&
        earliestDep >= d.startMin &&
        earliestDep < d.endMin
      ) {
        const extra = d.endMin - earliestDep;
        depClosureHoldMin += extra;
        earliestDep = d.endMin;
        projectedArr = earliestDep + duration;
        depClosureHit = d;
        isDirectClosureHit = true;
      }
    }

    const depDelayMin = Math.max(0, earliestDep - flight.schedDep);
    const arrDelayMin = Math.max(0, projectedArr - flight.schedArr);

    // 4. Construct deterministic Cause Chain for this flight
    const chain: CauseChainStep[] = baseChain.map((s, idx) => ({ ...s, stepNumber: idx + 1 }));

    if (spareOverride?.isEntryLeg) {
      const sp = spareById.get(spareOverride.spareId);
      chain.push({
        stepNumber: chain.length + 1,
        type: 'RECOVERY',
        flightId: flight.id,
        airportCode: flight.origin,
        title: `Spare Aircraft ${spareOverride.spareId} Deployed`,
        detail: `${sp?.model ?? 'Spare'} with fresh standby crew took over ${flight.id} (${flight.origin}→${flight.dest}) at ${flight.origin}.`,
      });
    } else if (crewSwapOverride?.isEntryLeg) {
      const sc = standbyCrewById.get(crewSwapOverride.standbyCrewId);
      chain.push({
        stepNumber: chain.length + 1,
        type: 'RECOVERY',
        flightId: flight.id,
        airportCode: flight.origin,
        title: `Standby Crew ${crewSwapOverride.standbyCrewId} Swapped In`,
        detail: `${sc?.name ?? 'Reserve crew'} relieved original crew ${flight.crewId} at ${flight.origin}, resetting FDTL duty clock.`,
      });
    }

    if (depDriver === 'AIRCRAFT' && upstreamFlightId) {
      const up = flightsById[upstreamFlightId];
      if (up && up.actualArr !== null) {
        chain.push({
          stepNumber: chain.length + 1,
          type: 'AIRCRAFT_TURN',
          flightId: flight.id,
          airportCode: flight.origin,
          title: `Late Inbound Aircraft ${effectiveAircraftId}`,
          detail: `Arrived from ${up.flight.origin} as ${upstreamFlightId} at ${formatTime(up.actualArr)} (+${up.arrDelayMin}m). With ${minTurn}m min turnaround, ${flight.id} departs ${formatTime(earliestDep - depClosureHoldMin - arrClosureHoldMin)}.`,
          delayDeltaMin: depDelayMin,
        });
      }
    } else if (depDriver === 'CREW' && upstreamFlightId) {
      const up = flightsById[upstreamFlightId];
      if (up && up.actualArr !== null) {
        chain.push({
          stepNumber: chain.length + 1,
          type: 'CREW_TRANSFER',
          flightId: flight.id,
          airportCode: flight.origin,
          title: `Late Inbound Crew ${effectiveCrewId}`,
          detail: `Crew arrived on ${upstreamFlightId} (${up.flight.aircraftId}) at ${formatTime(up.actualArr)} (+${up.arrDelayMin}m) and needed ${CREW_TRANSFER_MIN}m aircraft transfer at ${flight.origin}.`,
          delayDeltaMin: depDelayMin,
        });
      }
    }

    if (appliedHoldMin > 0 && holdOverride) {
      chain.push({
        stepNumber: chain.length + 1,
        type: 'CONNECTION_HOLD',
        flightId: flight.id,
        airportCode: flight.origin,
        title: `Held +${holdOverride.holdMinutes}m for Connecting Passengers`,
        detail: `${holdOverride.action.detail} Departure shifted to ${formatTime(earliestDep)}.`,
        delayDeltaMin: appliedHoldMin,
      });
    }

    if (depClosureHoldMin > 0 && depClosureHit) {
      chain.push({
        stepNumber: chain.length + 1,
        type: 'CLOSURE',
        flightId: flight.id,
        airportCode: depClosureHit.airportCode,
        title: `${depClosureHit.airportCode} Closed (${depClosureHit.reason})`,
        detail: `Ground stop ${formatTime(depClosureHit.startMin)}–${formatTime(depClosureHit.endMin)} held ${flight.id} departure by +${depClosureHoldMin}m until ${formatTime(depClosureHit.endMin)}.`,
        delayDeltaMin: depClosureHoldMin,
      });
    }

    if (arrClosureHoldMin > 0 && arrClosureHit) {
      chain.push({
        stepNumber: chain.length + 1,
        type: 'CLOSURE',
        flightId: flight.id,
        airportCode: arrClosureHit.airportCode,
        title: `${arrClosureHit.airportCode} Arrival Ground Delay (${arrClosureHit.reason})`,
        detail: `Destination ${arrClosureHit.airportCode} closed ${formatTime(arrClosureHit.startMin)}–${formatTime(arrClosureHit.endMin)}; held +${arrClosureHoldMin}m at ${flight.origin} to land at ${formatTime(arrClosureHit.endMin)}.`,
        delayDeltaMin: arrClosureHoldMin,
      });
    }

    // 5. Evaluate Legal Crew Duty Hours (FDTL)
    const effectiveReportTime =
      crState.reportTime !== null ? crState.reportTime : earliestDep - 45;
    const projectedDutyEnd = projectedArr + crState.debriefMinutes;
    const projectedDutyMinutes = projectedDutyEnd - effectiveReportTime;
    const crewBreachMin = Math.max(0, projectedDutyMinutes - crState.maxDutyMinutes);

    if (crewBreachMin > 0) {
      // Legal FDTL violation -> Flight CANNOT legally operate -> CANCELLED!
      crState.breached = true;
      if (!crState.breachedFlightId) crState.breachedFlightId = flight.id;

      chain.push({
        stepNumber: chain.length + 1,
        type: 'CREW_FDTL',
        flightId: flight.id,
        airportCode: flight.origin,
        title: `Crew ${effectiveCrewId} Exceeds Legal Duty Limit (+${crewBreachMin}m over FDTL)`,
        detail: `Crew reported at ${formatTime(effectiveReportTime)}. Operating ${flight.id} (${flight.origin}→${flight.dest}) would end duty at ${formatTime(projectedDutyEnd)} (${projectedDutyMinutes}m used vs ${crState.maxDutyMinutes}m legal max). Flight cancelled.`,
        delayDeltaMin: crewBreachMin,
      });

      const simFlight: SimulatedFlight = {
        flight,
        status: 'CANCELLED',
        actualDep: null,
        actualArr: null,
        depDelayMin,
        arrDelayMin,
        effectiveAircraftId,
        effectiveCrewId,
        rootCause: 'CREW_FDTL_CANCELLED',
        causeSummary: `Cancelled: Crew ${effectiveCrewId} ${crewBreachMin}m over ${crState.maxDutyMinutes}m legal duty limit`,
        causeChain: chain,
        upstreamFlightId,
        isDirectClosureHit,
        isRecoveredByAction: Boolean(spareOverride || crewSwapOverride),
        crewDutyAtArrivalMin: projectedDutyMinutes,
        crewMaxDutyMin: crState.maxDutyMinutes,
        crewBreachMin,
        cancelledLocalPax: flight.passengers,
        brokenOutboundConnections: 0,
        prevAircraftFlightId: acState.lastFlightId,
        scheduledTurnaroundMin: null,
        actualTurnaroundMin: null,
        turnaroundCompressedMin: 0,
      };
      simulatedFlights.push(simFlight);
      flightsById[flight.id] = simFlight;
      continue;
    }

    // 6. Flight Operates! Determine root cause label
    let rootCause: DelayRootCause = 'ON_TIME';
    let causeSummary = 'Operating on schedule';
    const isRecoveredByAction = Boolean(spareOverride || crewSwapOverride || holdOverride);

    if (arrDelayMin > 0) {
      if (depClosureHoldMin > 0) {
        rootCause = 'AIRPORT_CLOSURE_DEP';
        causeSummary = `Held +${depDelayMin}m at ${flight.origin} due to ${depClosureHit?.reason.toLowerCase() ?? 'airport closure'}`;
      } else if (arrClosureHoldMin > 0) {
        rootCause = 'AIRPORT_CLOSURE_ARR';
        causeSummary = `Held +${arrDelayMin}m for ${flight.dest} ${arrClosureHit?.reason.toLowerCase() ?? 'closure'} reopening`;
      } else if (depDriver === 'HOLD' && holdOverride) {
        rootCause = 'CONNECTION_HOLD';
        causeSummary = `Held +${depDelayMin}m at ${flight.origin} to protect connecting passengers`;
      } else if (depDriver === 'CREW') {
        rootCause = 'CREW_CASCADE';
        causeSummary = `Late inbound crew ${effectiveCrewId} from ${upstreamFlightId} (+${depDelayMin}m)`;
      } else {
        rootCause = 'AIRCRAFT_CASCADE';
        causeSummary = `Late inbound aircraft ${effectiveAircraftId} from ${upstreamFlightId} (+${depDelayMin}m)`;
      }
    } else if (spareOverride) {
      rootCause = 'RECOVERED_SPARE';
      causeSummary = `Recovered on time via spare aircraft ${spareOverride.spareId}`;
    } else if (crewSwapOverride) {
      rootCause = 'RECOVERED_CREW';
      causeSummary = `Protected via standby crew ${crewSwapOverride.standbyCrewId}`;
    }

    // Turnaround compression tracking for Gantt hatched buffer zones
    const scheduledTurnaroundMin =
      acState.lastSchedArr !== null ? Math.max(0, flight.schedDep - acState.lastSchedArr) : null;
    const actualTurnaroundMin =
      acState.lastActualArr !== null ? Math.max(0, earliestDep - acState.lastActualArr) : null;
    const turnaroundCompressedMin =
      scheduledTurnaroundMin !== null && actualTurnaroundMin !== null
        ? Math.max(0, scheduledTurnaroundMin - actualTurnaroundMin)
        : 0;

    const simFlight: SimulatedFlight = {
      flight,
      status: arrDelayMin > 0 ? 'DELAYED' : 'ON_TIME',
      actualDep: earliestDep,
      actualArr: projectedArr,
      depDelayMin,
      arrDelayMin,
      effectiveAircraftId,
      effectiveCrewId,
      rootCause,
      causeSummary,
      causeChain: chain,
      upstreamFlightId,
      isDirectClosureHit,
      isRecoveredByAction,
      crewDutyAtArrivalMin: projectedDutyMinutes,
      crewMaxDutyMin: crState.maxDutyMinutes,
      crewBreachMin: 0,
      cancelledLocalPax: 0,
      brokenOutboundConnections: 0,
      prevAircraftFlightId: acState.lastFlightId,
      scheduledTurnaroundMin,
      actualTurnaroundMin,
      turnaroundCompressedMin,
    };

    simulatedFlights.push(simFlight);
    flightsById[flight.id] = simFlight;

    // Update Aircraft & Crew states for downstream propagation
    acState.readyAt = projectedArr + minTurn;
    acState.lastActualArr = projectedArr;
    acState.lastSchedArr = flight.schedArr;
    acState.lastFlightId = flight.id;
    acState.lastAirport = flight.dest;
    acState.lastCauseChain = arrDelayMin > 0 ? chain : [];

    if (crState.reportTime === null) {
      crState.reportTime = earliestDep - 45;
    }
    crState.readyAt = projectedArr;
    crState.lastFlightId = flight.id;
    crState.lastAircraftId = effectiveAircraftId;
    crState.lastCauseChain = arrDelayMin > 0 ? chain : [];
    crState.actualDutyEnd = Math.max(crState.actualDutyEnd, projectedDutyEnd);
    crState.flightIds.push(flight.id);
  }

  // 7. Evaluate All Passenger Connections (MCT) without double-counting cancelled flight passengers
  const simulatedConnections: SimulatedConnection[] = [];
  let strandedFromMissedConnections = 0;
  let brokenConnectionsCount = 0;

  for (const conn of dataset.connections) {
    const feeder = flightsById[conn.fromFlightId];
    const onward = flightsById[conn.toFlightId];
    if (!feeder || !onward) continue;

    if (feeder.status === 'CANCELLED' || onward.status === 'CANCELLED') {
      // Passengers on a cancelled flight are ALREADY counted in that cancelled flight's passenger manifest.
      // We mark the connection as MISSED_CANCELLED for visibility, and set additional incremental stranded = 0
      // to guarantee zero double-counting!
      brokenConnectionsCount++;
      simulatedConnections.push({
        connection: conn,
        status: 'MISSED_CANCELLED',
        feederActualArr: feeder.actualArr,
        onwardActualDep: onward.actualDep,
        availableMinutes: null,
        shortfallMinutes: conn.mctMinutes,
        strandedPassengers: 0, // Already counted in cancelled flight's pax count
      });
      continue;
    }

    const available = (onward.actualDep ?? onward.flight.schedDep) - (feeder.actualArr ?? feeder.flight.schedArr);
    if (available < conn.mctMinutes) {
      brokenConnectionsCount++;
      strandedFromMissedConnections += conn.passengers;
      feeder.brokenOutboundConnections += conn.passengers;
      simulatedConnections.push({
        connection: conn,
        status: 'MISSED_DELAY',
        feederActualArr: feeder.actualArr,
        onwardActualDep: onward.actualDep,
        availableMinutes: available,
        shortfallMinutes: conn.mctMinutes - available,
        strandedPassengers: conn.passengers,
      });
    } else {
      const wasSavedByHold =
        holdByFlight.has(onward.flight.id) &&
        onward.flight.schedDep - (feeder.actualArr ?? feeder.flight.schedArr) < conn.mctMinutes;
      simulatedConnections.push({
        connection: conn,
        status: wasSavedByHold ? 'SAVED_BY_HOLD' : 'INTACT',
        feederActualArr: feeder.actualArr,
        onwardActualDep: onward.actualDep,
        availableMinutes: available,
        shortfallMinutes: 0,
        strandedPassengers: 0,
      });
    }
  }

  // 8. Build Crew Duty Summaries
  const simulatedCrews: SimulatedCrew[] = dataset.crews.map((crew) => {
    const st = crewState.get(crew.id)!;
    const rep = st.reportTime ?? 360;
    const used = Math.max(0, st.actualDutyEnd - rep);
    return {
      crew,
      flightIds: st.flightIds,
      reportTime: rep,
      scheduledDutyEnd: st.scheduledDutyEnd,
      actualDutyEnd: st.actualDutyEnd,
      dutyMinutesUsed: used,
      maxDutyMinutes: crew.maxDutyMinutes,
      utilizationPct: Math.round((used / crew.maxDutyMinutes) * 100),
      breached: st.breached,
      breachedFlightId: st.breachedFlightId,
    };
  });

  // 9. Aggregate Deterministic Summary Metrics
  let onTimeFlights = 0;
  let delayedFlights = 0;
  let cancelledFlights = 0;
  let fdtlCancelledFlights = 0;
  let recoveryCancelledFlights = 0;
  let totalDelayMinutes = 0;
  let maxDelayMinutes = 0;
  let strandedFromCancellations = 0;
  let cascadeDepthMax = 0;
  const affectedAirports = new Set<string>();

  for (const sf of simulatedFlights) {
    if (sf.status === 'ON_TIME') {
      onTimeFlights++;
    } else if (sf.status === 'DELAYED') {
      delayedFlights++;
      totalDelayMinutes += sf.arrDelayMin;
      if (sf.arrDelayMin > maxDelayMinutes) maxDelayMinutes = sf.arrDelayMin;
      affectedAirports.add(sf.flight.origin);
      affectedAirports.add(sf.flight.dest);
    } else {
      cancelledFlights++;
      if (sf.rootCause === 'CREW_FDTL_CANCELLED') fdtlCancelledFlights++;
      if (sf.rootCause === 'RECOVERY_CANCELLED') recoveryCancelledFlights++;
      strandedFromCancellations += sf.cancelledLocalPax;
      affectedAirports.add(sf.flight.origin);
      affectedAirports.add(sf.flight.dest);
    }
    if (sf.causeChain.length > cascadeDepthMax) {
      cascadeDepthMax = sf.causeChain.length;
    }
  }

  const crewBreachesCount = simulatedCrews.filter((c) => c.breached).length;

  const strandedPassengers = strandedFromCancellations + strandedFromMissedConnections;
  const costBreakdown = computeDeterministicCostBreakdown(
    strandedPassengers,
    cancelledFlights,
    totalDelayMinutes,
    actions,
    dataset
  );

  const summary: SimulationSummary = {
    totalFlights: simulatedFlights.length,
    onTimeFlights,
    delayedFlights,
    cancelledFlights,
    fdtlCancelledFlights,
    recoveryCancelledFlights,
    totalDelayMinutes,
    avgDelayPerDelayedFlight: delayedFlights > 0 ? Math.round(totalDelayMinutes / delayedFlights) : 0,
    maxDelayMinutes,
    strandedPassengers,
    strandedFromCancellations,
    strandedFromMissedConnections,
    brokenConnectionsCount,
    totalConnectionsCount: simulatedConnections.length,
    crewBreachesCount,
    affectedAirportsCount: affectedAirports.size,
    cascadeDepthMax,
    estimatedCostInr: costBreakdown.totalCostInr,
    costBreakdown,
  };

  return {
    disruption,
    secondaryDisruption,
    disruptions: activeDisruptions,
    actions,
    flights: simulatedFlights,
    flightsById,
    connections: simulatedConnections,
    crews: simulatedCrews,
    summary,
  };
}
