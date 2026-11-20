import { NetworkDataset, SimulationResult } from '../types/network';
import { COST_WEIGHTS_INR, formatInrCompact, formatInrDelta } from './costEstimator';
import { formatDelta, formatTime } from './time';

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFlightManifestCsv(
  result: SimulationResult,
  baseline: SimulationResult
) {
  const headers = [
    'Flight ID',
    'Origin',
    'Destination',
    'Sched Dep',
    'Sched Arr',
    'Actual Dep',
    'Actual Arr',
    'Status',
    'Delay (min)',
    'Baseline Delay (min)',
    'Turnaround Compressed (min)',
    'Effective Aircraft',
    'Effective Crew',
    'Passengers',
    'Root Cause',
    'Cause Summary',
  ];

  const rows = result.flights.map((sf) => {
    const base = baseline.flightsById[sf.flight.id];
    return [
      sf.flight.id,
      sf.flight.origin,
      sf.flight.dest,
      formatTime(sf.flight.schedDep),
      formatTime(sf.flight.schedArr),
      sf.actualDep !== null ? formatTime(sf.actualDep) : 'CANCELLED',
      sf.actualArr !== null ? formatTime(sf.actualArr) : 'CANCELLED',
      sf.status,
      sf.arrDelayMin,
      base ? base.arrDelayMin : sf.arrDelayMin,
      sf.turnaroundCompressedMin,
      sf.effectiveAircraftId,
      sf.effectiveCrewId,
      sf.flight.passengers,
      sf.rootCause,
      sf.causeSummary,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const tag = result.disruption ? result.disruption.airportCode.toLowerCase() : 'clear-skies';
  triggerFileDownload(`domino-sky-manifest-${tag}.csv`, csv, 'text/csv;charset=utf-8;');
}

export function exportExecutiveBriefingMarkdown(
  dataset: NetworkDataset,
  baseline: SimulationResult,
  result: SimulationResult,
  dispatcherLabel: string
) {
  const disruptions = baseline.disruptions;
  const hasRecovery = result.actions.length > 0;
  const header =
    disruptions.length > 0
      ? disruptions
          .map(
            (d) =>
              `${d.airportCode} ${d.reason} (${formatTime(d.startMin)}–${formatTime(d.endMin)}, ${d.endMin - d.startMin}m)`
          )
          .join(' + ')
      : 'Clear Skies Baseline';

  const costDelta = result.summary.estimatedCostInr - baseline.summary.estimatedCostInr;
  const costSaved = Math.max(0, baseline.summary.estimatedCostInr - result.summary.estimatedCostInr);

  const lines: string[] = [
    `# Domino Sky — Post-Mortem Incident & Recovery Brief`,
    ``,
    `- **Disruption Event(s)**: ${header}`,
    `- **Network Scope**: ${dataset.airports.length} Airports · ${dataset.flights.length} Flights · ${dataset.aircraft.length} Aircraft · ${dataset.connections.length} Connections`,
    `- **Prepared By**: ${dispatcherLabel}`,
    `- **Recovery Applied**: ${hasRecovery ? `${result.actions.length} action(s)` : 'None (Disrupted Baseline)'}`,
    ``,
    `## 1. Deterministic Before vs. After KPI & Financial Summary`,
    ``,
    `| Metric | Baseline (Unrecovered) | Current State | Delta |`,
    `| :--- | ---: | ---: | ---: |`,
    `| Delayed Flights | ${baseline.summary.delayedFlights} | ${result.summary.delayedFlights} | ${formatDelta(result.summary.delayedFlights - baseline.summary.delayedFlights)} |`,
    `| Cancelled Flights | ${baseline.summary.cancelledFlights} | ${result.summary.cancelledFlights} | ${formatDelta(result.summary.cancelledFlights - baseline.summary.cancelledFlights)} |`,
    `| Total Delay Minutes | ${baseline.summary.totalDelayMinutes}m | ${result.summary.totalDelayMinutes}m | ${formatDelta(result.summary.totalDelayMinutes - baseline.summary.totalDelayMinutes, 'm')} |`,
    `| Stranded Passengers | ${baseline.summary.strandedPassengers} | ${result.summary.strandedPassengers} | ${formatDelta(result.summary.strandedPassengers - baseline.summary.strandedPassengers)} |`,
    `| Broken Connections | ${baseline.summary.brokenConnectionsCount} | ${result.summary.brokenConnectionsCount} | ${formatDelta(result.summary.brokenConnectionsCount - baseline.summary.brokenConnectionsCount)} |`,
    `| Crew FDTL Breaches | ${baseline.summary.crewBreachesCount} | ${result.summary.crewBreachesCount} | ${formatDelta(result.summary.crewBreachesCount - baseline.summary.crewBreachesCount)} |`,
    `| Impacted Airports | ${baseline.summary.affectedAirportsCount} | ${result.summary.affectedAirportsCount} | ${formatDelta(result.summary.affectedAirportsCount - baseline.summary.affectedAirportsCount)} |`,
    `| **Estimated Disruption Cost (INR)** | **${formatInrCompact(baseline.summary.estimatedCostInr)}** | **${formatInrCompact(result.summary.estimatedCostInr)}** | **${formatInrDelta(costDelta)}** |`,
    ``,
    `### Deterministic Financial Cost Breakdown`,
    `- **Cost Weights**: ₹${COST_WEIGHTS_INR.perStrandedPassenger.toLocaleString('en-IN')}/stranded pax · ₹${COST_WEIGHTS_INR.perCancelledFlight.toLocaleString('en-IN')}/cancelled flight · ₹${COST_WEIGHTS_INR.perDelayMinute.toLocaleString('en-IN')}/delay min · Spare/Reserve dispatch cost.`,
    `- **Current Breakdown**: Stranded Pax ${formatInrCompact(result.summary.costBreakdown.strandedPaxCostInr)} · Cancellations ${formatInrCompact(result.summary.costBreakdown.cancellationCostInr)} · Delay Burn ${formatInrCompact(result.summary.costBreakdown.delayMinuteCostInr)} · Recovery Resources ${formatInrCompact(result.summary.costBreakdown.recoveryResourceCostInr)}.`,
    ...(hasRecovery ? [`- **Net Disruption Cost Saved**: **${formatInrCompact(costSaved)}**`] : []),
    ``,
  ];

  if (hasRecovery) {
    lines.push(`## 2. Applied Recovery Playbook (${result.actions.length} Step${result.actions.length === 1 ? '' : 's'})`, ``);
    result.actions.forEach((act, idx) => {
      lines.push(`${idx + 1}. **${act.label}** — ${act.detail}`);
    });
    lines.push(``);
  }

  // Root-Cause Breakdown
  const rootCauseCounts = new Map<string, number>();
  for (const sf of result.flights) {
    if (sf.status !== 'ON_TIME') {
      rootCauseCounts.set(sf.rootCause, (rootCauseCounts.get(sf.rootCause) ?? 0) + 1);
    }
  }
  if (rootCauseCounts.size > 0) {
    lines.push(`## 3. Root-Cause Propagation Breakdown`, ``);
    for (const [cause, count] of [...rootCauseCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${cause.replace(/_/g, ' ')}**: ${count} flight(s)`);
    }
    lines.push(``);
  }

  const cancelled = result.flights.filter((f) => f.status === 'CANCELLED');
  if (cancelled.length > 0) {
    lines.push(`## 4. Cancelled Flights & Causal Chains (${cancelled.length})`, ``);
    for (const f of cancelled) {
      lines.push(`- **${f.flight.id}** (${f.flight.origin}→${f.flight.dest}, ${f.flight.passengers} pax, ${f.effectiveAircraftId}/${f.effectiveCrewId}): ${f.causeSummary}`);
      if (f.causeChain.length > 0) {
        const lineage = f.causeChain.map((s) => s.title).join(' → ');
        lines.push(`  - *Domino Lineage*: ${lineage}`);
      }
    }
    lines.push(``);
  }

  const brokenConns = result.connections.filter((c) => c.status === 'MISSED_DELAY' || c.status === 'MISSED_CANCELLED');
  if (brokenConns.length > 0) {
    lines.push(`## 5. Broken Hub Passenger Connections (${brokenConns.length})`, ``);
    for (const c of brokenConns.slice(0, 12)) {
      lines.push(
        `- **${c.connection.airportCode}**: ${c.connection.fromFlightId} → ${c.connection.toFlightId} (${c.connection.passengers} pax, ${c.status === 'MISSED_DELAY' ? `short by ${c.shortfallMinutes}m` : 'flight cancelled'})`
      );
    }
    lines.push(``);
  }

  const topDelayed = result.flights
    .filter((f) => f.status === 'DELAYED')
    .sort((a, b) => b.arrDelayMin - a.arrDelayMin)
    .slice(0, 10);

  if (topDelayed.length > 0) {
    lines.push(`## 6. Most Delayed Flights (Top ${topDelayed.length})`, ``);
    for (const f of topDelayed) {
      lines.push(
        `- **${f.flight.id}** (${f.flight.origin}→${f.flight.dest}, ${f.effectiveAircraftId}): +${f.arrDelayMin}m · ${f.causeSummary}`
      );
    }
    lines.push(``);
  }

  const tag = disruptions.length > 0 ? disruptions.map((d) => d.airportCode.toLowerCase()).join('-') : 'clear-skies';
  triggerFileDownload(`domino-sky-postmortem-${tag}.md`, lines.join('\n'), 'text/markdown;charset=utf-8;');
}
