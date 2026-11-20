export interface Airport {
  code: string;
  name: string;
  city: string;
  tier: 'hub' | 'regional' | 'spoke';
  lat: number;
  lon: number;
  mctMinutes: number; // Minimum Connection Time for passengers
}

export interface Aircraft {
  id: string; // e.g., VT-DSA
  model: string;
  capacity: number;
  homeBase: string;
  minTurnaroundMin: number;
}

export interface Crew {
  id: string; // e.g., CR-01
  name: string; // e.g., Capt. Nair / FO Verma
  base: string;
  maxDutyMinutes: number; // Legal FDTL limit in minutes
  reportBeforeFirstFlightMin: number;
  debriefAfterLastFlightMin: number;
}

export interface Flight {
  id: string; // e.g., DS-101
  origin: string;
  dest: string;
  aircraftId: string;
  crewId: string;
  schedDep: number; // minutes from 00:00 (e.g. 515 = 08:35)
  schedArr: number; // minutes from 00:00
  passengers: number;
}

export interface PassengerConnection {
  id: string;
  fromFlightId: string;
  toFlightId: string;
  airportCode: string;
  passengers: number;
  mctMinutes: number;
}

export interface SpareAircraft {
  id: string; // e.g., VT-SP1
  model: string;
  capacity: number;
  baseAirport: string;
  readyFrom: number; // minutes from 00:00
  includesFreshCrew: boolean;
  operatingCostInrLakhs: number;
}

export interface StandbyCrew {
  id: string; // e.g., SB-BOM
  name: string;
  baseAirport: string;
  readyFrom: number;
  maxDutyMinutes: number;
}

export interface NetworkDataset {
  name: string;
  airports: Airport[];
  aircraft: Aircraft[];
  flights: Flight[];
  crews: Crew[];
  connections: PassengerConnection[];
  spares: SpareAircraft[];
  standbyCrews: StandbyCrew[];
}

export interface DisruptionConfig {
  airportCode: string;
  startMin: number;
  endMin: number;
  reason: 'Thunderstorm' | 'Dense Fog' | 'Runway Closure' | 'ATC Ground Stop';
}

export type RecoveryActionType =
  | 'DEPLOY_SPARE'
  | 'SWAP_CREW'
  | 'CANCEL_FLIGHT'
  | 'CANCEL_PAIR'
  | 'HOLD_CONNECTION';

export interface RecoveryAction {
  id: string;
  type: RecoveryActionType;
  label: string;
  detail: string;
  flightId: string;
  secondFlightId?: string; // Used for CANCEL_PAIR (out-and-back shuttle)
  spareId?: string; // Used for DEPLOY_SPARE
  standbyCrewId?: string; // Used for SWAP_CREW
  holdMinutes?: number; // Used for HOLD_CONNECTION
  connectionId?: string; // Used for HOLD_CONNECTION
}

export type DelayRootCause =
  | 'ON_TIME'
  | 'AIRPORT_CLOSURE_DEP'
  | 'AIRPORT_CLOSURE_ARR'
  | 'AIRCRAFT_CASCADE'
  | 'CREW_CASCADE'
  | 'CREW_FDTL_CANCELLED'
  | 'RECOVERY_CANCELLED'
  | 'CONNECTION_HOLD'
  | 'RECOVERED_SPARE'
  | 'RECOVERED_CREW';

export interface CauseChainStep {
  stepNumber: number;
  type: 'CLOSURE' | 'FLIGHT_DELAY' | 'AIRCRAFT_TURN' | 'CREW_TRANSFER' | 'CREW_FDTL' | 'RECOVERY' | 'CONNECTION_HOLD';
  flightId?: string;
  airportCode?: string;
  title: string;
  detail: string;
  delayDeltaMin?: number;
}

export interface SimulatedFlight {
  flight: Flight;
  status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
  actualDep: number | null;
  actualArr: number | null;
  depDelayMin: number;
  arrDelayMin: number;
  effectiveAircraftId: string;
  effectiveCrewId: string;
  rootCause: DelayRootCause;
  causeSummary: string;
  causeChain: CauseChainStep[];
  upstreamFlightId: string | null;
  isDirectClosureHit: boolean;
  isRecoveredByAction: boolean;
  crewDutyAtArrivalMin: number | null;
  crewMaxDutyMin: number;
  crewBreachMin: number; // > 0 if over legal duty
  cancelledLocalPax: number; // Pax stranded strictly because this flight cancelled
  brokenOutboundConnections: number; // Pax arriving on this flight who miss their next leg
  prevAircraftFlightId: string | null; // Previous flight operated by same effective aircraft
  scheduledTurnaroundMin: number | null; // Scheduled ground buffer before this flight
  actualTurnaroundMin: number | null; // Actual ground turn before this flight
  turnaroundCompressedMin: number; // Minutes of scheduled buffer absorbed (> 0 means compressed turnaround)
}

export interface SimulatedConnection {
  connection: PassengerConnection;
  status: 'INTACT' | 'MISSED_DELAY' | 'MISSED_CANCELLED' | 'SAVED_BY_HOLD';
  feederActualArr: number | null;
  onwardActualDep: number | null;
  availableMinutes: number | null;
  shortfallMinutes: number;
  strandedPassengers: number;
}

export interface SimulatedCrew {
  crew: Crew;
  flightIds: string[];
  reportTime: number;
  scheduledDutyEnd: number;
  actualDutyEnd: number;
  dutyMinutesUsed: number;
  maxDutyMinutes: number;
  utilizationPct: number;
  breached: boolean;
  breachedFlightId: string | null;
}

export interface SimulationSummary {
  totalFlights: number;
  onTimeFlights: number;
  delayedFlights: number;
  cancelledFlights: number;
  fdtlCancelledFlights: number;
  recoveryCancelledFlights: number;
  totalDelayMinutes: number;
  avgDelayPerDelayedFlight: number;
  maxDelayMinutes: number;
  strandedPassengers: number;
  strandedFromCancellations: number;
  strandedFromMissedConnections: number;
  brokenConnectionsCount: number;
  totalConnectionsCount: number;
  crewBreachesCount: number;
  affectedAirportsCount: number;
  cascadeDepthMax: number;
  estimatedCostInr: number;
  costBreakdown: {
    strandedPaxCostInr: number;
    cancellationCostInr: number;
    delayMinuteCostInr: number;
    recoveryResourceCostInr: number;
    totalCostInr: number;
  };
}

export interface SimulationResult {
  disruption: DisruptionConfig | null;
  secondaryDisruption: DisruptionConfig | null;
  disruptions: DisruptionConfig[];
  actions: RecoveryAction[];
  flights: SimulatedFlight[];
  flightsById: Record<string, SimulatedFlight>;
  connections: SimulatedConnection[];
  crews: SimulatedCrew[];
  summary: SimulationSummary;
}

export interface CandidatePlanEvaluation {
  planId: string;
  title: string;
  category: 'SPARE_SWAP' | 'CREW_SWAP' | 'SELECTIVE_CANCEL' | 'CONNECTION_HOLD' | 'COMBINED';
  actions: RecoveryAction[];
  before: SimulationSummary;
  after: SimulationSummary;
  deltas: {
    delayedFlights: number;
    cancelledFlights: number;
    totalDelayMinutes: number;
    strandedPassengers: number;
    crewBreachesCount: number;
    estimatedCostInr: number;
  };
  rescuedFlightIds: string[];
  newlyCancelledFlightIds: string[];
  score: number;
}

export type DispatchPriority =
  | 'BALANCED'
  | 'MINIMIZE_STRANDED'
  | 'ZERO_CANCELLATIONS'
  | 'MINIMIZE_DELAY'
  | 'LOW_RESOURCE';

export interface AIDispatcherRecommendation {
  planId: string;
  rank: number;
  badge: string;
  headline: string;
  rationale: string;
  tradeOff: string;
  operationalSteps: string[];
}

export interface AIDispatcherResponse {
  executiveBriefing: string;
  dominoMechanism: string;
  tradeOffComparison?: string;
  recommendations: AIDispatcherRecommendation[];
  modelUsed: string;
  priorityUsed?: DispatchPriority;
}

export interface ParsedScenarioResponse {
  airportCode: string;
  startMin: number;
  endMin: number;
  reason: DisruptionConfig['reason'];
  priority: DispatchPriority;
  interpretation: string;
}

export interface AICommsResponse {
  passengerAdvisory: {
    subject: string;
    smsText: string;
    gateAnnouncement: string;
  };
  crewDirective: {
    subject: string;
    directiveText: string;
  };
  executiveSitrep: {
    subject: string;
    summaryText: string;
  };
  modelUsed: string;
}

export interface AIFlightExplainResponse {
  plainEnglishSummary: string;
  passengerGateNotice: string;
  recommendedNextStep: string;
  modelUsed: string;
}

