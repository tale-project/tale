/**
 * The run report: one JSON document per generator (mergeable across the
 * shards of a distributed run) and a Markdown rendering for people.
 *
 * The JSON keeps the merged metrics snapshot itself, not only the summary,
 * so `merge` can fold the reports of fifty generators into the exact
 * distribution of the whole run — percentiles do not average.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  type MetricsSnapshot,
  type MetricsSummary,
  type ThresholdResult,
  evaluateThresholds,
  formatSummary,
  mergeSnapshots,
  metricsSnapshotSchema,
  parseThresholds,
  summarize,
} from '../metrics/index.ts';
import type { RunOutcome, StageResult } from './orchestrator.ts';
import {
  type DatabaseDelta,
  type ServerMetricsDelta,
  diffDatabase,
  diffServerMetrics,
} from './probes.ts';

/**
 * The service levels a run is judged against unless a thresholds file says
 * otherwise. `chat.ttft` is measured in the browser's place — from the send
 * to the first streamed text — so it includes the model provider's own time
 * to first token (the mock's median is 450 ms) on top of the platform's.
 */
export const DEFAULT_THRESHOLDS: Record<string, string | string[]> = {
  'http.p95': '<1000',
  'http.p99': '<3000',
  'errors.errorRate': '<0.01',
  'chat.ttft.p95': '<3000',
  'chat.ttft.mean': '<1500',
};

export interface RunReport {
  version: 1;
  tool: '@tale/load';
  profile: string;
  peakUsers: number;
  planRunId: string;
  targets: string[];
  shard: { index: number; count: number };
  /** Shard reports this one was folded from (counting through a merge of
   * merged reports); absent on a shard's own. */
  mergedFrom?: number;
  processes: number;
  startedAt: string;
  endedAt: string;
  outcome: {
    stoppedEarly: boolean;
    breakingPoint: { stage: number; users: number } | null;
    stages: StageResult[];
    workerFailures: string[];
    stragglers: number;
  };
  thresholdSpec: Record<string, string | string[]>;
  thresholds: ThresholdResult[];
  passed: boolean;
  summary: MetricsSummary;
  server: {
    metrics: ServerMetricsDelta[];
    database: DatabaseDelta | null;
  };
  snapshot: MetricsSnapshot;
}

const runReportSchema = z
  .object({
    version: z.literal(1),
    tool: z.literal('@tale/load'),
    snapshot: metricsSnapshotSchema,
    thresholdSpec: z.record(
      z.string(),
      z.union([z.string(), z.array(z.string())]),
    ),
  })
  .passthrough();

export function buildReport(args: {
  outcome: RunOutcome;
  profile: string;
  peakUsers: number;
  planRunId: string;
  targets: string[];
  shard: { index: number; count: number };
  processes: number;
  thresholdSpec: Record<string, string | string[]>;
}): RunReport {
  const { outcome } = args;
  const summary = summarize(outcome.snapshot);
  const thresholds = evaluateThresholds(
    parseThresholds(args.thresholdSpec),
    summary,
  );
  const metrics = outcome.probes.metricsAfter.map((after, i) => {
    const before = outcome.probes.metricsBefore[i];
    return before === undefined
      ? diffServerMetrics(after, after)
      : diffServerMetrics(before, after);
  });
  const database =
    outcome.probes.databaseBefore !== null &&
    outcome.probes.databaseAfter !== null
      ? diffDatabase(
          outcome.probes.databaseBefore,
          outcome.probes.databaseAfter,
        )
      : null;
  return {
    version: 1,
    tool: '@tale/load',
    profile: args.profile,
    peakUsers: args.peakUsers,
    planRunId: args.planRunId,
    targets: args.targets,
    shard: args.shard,
    processes: args.processes,
    startedAt: new Date(outcome.startedAt).toISOString(),
    endedAt: new Date(outcome.endedAt).toISOString(),
    outcome: {
      stoppedEarly: outcome.stoppedEarly,
      breakingPoint: outcome.breakingPoint,
      stages: outcome.stages,
      workerFailures: outcome.workerFailures,
      stragglers: outcome.stragglers,
    },
    thresholdSpec: args.thresholdSpec,
    thresholds,
    passed:
      thresholds.every((t) => t.ok) && outcome.workerFailures.length === 0,
    summary,
    server: { metrics, database },
    snapshot: outcome.snapshot,
  };
}

/** Write a file atomically: a reader never sees half a report. */
export async function writeAtomically(
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

export async function readReport(path: string): Promise<RunReport> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  runReportSchema.parse(raw);
  return raw as RunReport;
}

/**
 * Fold the reports of a distributed run's shards into one. Server-side
 * probes are taken from the first report that has them: every generator
 * read the same deployment, so they must not be added up.
 */
/**
 * The shards' stages as stages of the whole run: the load summed, held only
 * where every shard held. A stage some shard never reached is left out — the
 * run never stood at its merged load. Each shard keeps a stage's p95 only,
 * not its histogram, so the merged p95 is the slowest shard's: an upper
 * bound of the run's.
 */
function mergeStages(
  reports: readonly RunReport[],
): RunReport['outcome']['stages'] {
  const depth = Math.min(...reports.map((r) => r.outcome.stages.length));
  const stages: RunReport['outcome']['stages'] = [];
  for (let index = 0; index < depth; index += 1) {
    const parts = reports.map((r) => r.outcome.stages[index]);
    const requests = parts.reduce((sum, s) => sum + (s?.requests ?? 0), 0);
    const errors = parts.reduce((sum, s) => sum + (s?.errors ?? 0), 0);
    stages.push({
      stage: index,
      users: parts.reduce((sum, s) => sum + (s?.users ?? 0), 0),
      requests,
      errors,
      errorRate: requests > 0 ? errors / requests : 0,
      p95Ms: Math.max(...parts.map((s) => s?.p95Ms ?? 0)),
      held: parts.every((s) => s?.held === true),
    });
  }
  return stages;
}

/**
 * The run held through a stage only if every shard did: the earliest
 * breaking point wins, at the merged stage's load. A profile without
 * breakpoints (every shard null) has none.
 */
function mergeBreakingPoint(
  reports: readonly RunReport[],
  stages: RunReport['outcome']['stages'],
): RunReport['outcome']['breakingPoint'] {
  const points = reports.map((r) => r.outcome.breakingPoint);
  if (points.every((p) => p === null)) return null;
  if (points.some((p) => p === null)) return null;
  const stage = Math.min(...points.map((p) => p?.stage ?? 0));
  const merged = stages[stage];
  return merged === undefined ? null : { stage, users: merged.users };
}

export function mergeReports(
  reports: readonly RunReport[],
  thresholdSpec?: Record<string, string | string[]>,
): RunReport {
  const first = reports[0];
  if (first === undefined) throw new Error('merge needs at least one report');
  const stages = mergeStages(reports);
  const snapshot = mergeSnapshots(reports.map((r) => r.snapshot));
  const summary = summarize(snapshot);
  const spec = thresholdSpec ?? first.thresholdSpec;
  const thresholds = evaluateThresholds(parseThresholds(spec), summary);
  const failures = reports.flatMap((r) => r.outcome.workerFailures);
  const shards = reports.reduce((sum, r) => sum + (r.mergedFrom ?? 1), 0);
  return {
    ...first,
    peakUsers: reports.reduce((sum, r) => sum + r.peakUsers, 0),
    shard: { index: 0, count: shards },
    mergedFrom: shards,
    processes: reports.reduce((sum, r) => sum + r.processes, 0),
    targets: [...new Set(reports.flatMap((r) => r.targets))],
    startedAt: reports.map((r) => r.startedAt).sort()[0] ?? first.startedAt,
    endedAt:
      reports
        .map((r) => r.endedAt)
        .sort()
        .at(-1) ?? first.endedAt,
    outcome: {
      stoppedEarly: reports.some((r) => r.outcome.stoppedEarly),
      breakingPoint: mergeBreakingPoint(reports, stages),
      stages,
      workerFailures: failures,
      stragglers: reports.reduce((sum, r) => sum + r.outcome.stragglers, 0),
    },
    thresholdSpec: spec,
    thresholds,
    passed: thresholds.every((t) => t.ok) && failures.length === 0,
    summary,
    server:
      reports.find(
        (r) => r.server.metrics.length > 0 || r.server.database !== null,
      )?.server ?? first.server,
    snapshot,
  };
}

function ms(value: number): string {
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

/** The report for people: what was run, whether it held, and why not. */
export function renderMarkdown(report: RunReport): string {
  const lines: string[] = [];
  const verdict = report.passed ? 'PASSED' : 'FAILED';
  lines.push(
    `# Load run: ${report.profile}, ${report.peakUsers.toLocaleString('en-US')} users — ${verdict}`,
  );
  lines.push('');
  lines.push(
    `- Plan \`${report.planRunId}\`, shards ${report.shard.count}, generator processes ${report.processes}`,
  );
  lines.push(`- Targets: ${report.targets.join(', ')}`);
  lines.push(
    `- ${report.startedAt} → ${report.endedAt} (${Math.round(report.summary.durationS)} s)`,
  );
  if (report.outcome.stoppedEarly)
    lines.push('- Stopped early (breakpoint or interrupt).');
  if (report.outcome.breakingPoint !== null) {
    lines.push(
      `- Breaking point: held through ${report.outcome.breakingPoint.users.toLocaleString('en-US')} users (stage ${report.outcome.breakingPoint.stage + 1}).`,
    );
  }
  if (report.outcome.workerFailures.length > 0) {
    lines.push(
      `- Generator failures: ${report.outcome.workerFailures.join('; ')}`,
    );
  }
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push('| threshold | expression | actual | result |');
  lines.push('| --- | --- | --- | --- |');
  for (const t of report.thresholds) {
    lines.push(
      `| \`${t.key}\` | \`${t.expression}\` | ${t.actual === null ? '–' : Number(t.actual.toFixed(4))} | ${t.ok ? 'ok' : `**failed**${t.reason ? ` (${t.reason})` : ''}`} |`,
    );
  }
  if (report.outcome.stages.length > 0) {
    lines.push('');
    lines.push('## Stages');
    lines.push('');
    if (report.mergedFrom !== undefined && report.mergedFrom > 1) {
      lines.push(
        `Merged from ${report.mergedFrom} shards: load summed, p95 the slowest shard's (an upper bound), held only where every shard held.`,
      );
      lines.push('');
    }
    lines.push('| stage | users | requests | p95 | errors | held |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of report.outcome.stages) {
      lines.push(
        `| ${s.stage + 1} | ${s.users.toLocaleString('en-US')} | ${s.requests.toLocaleString('en-US')} | ${ms(s.p95Ms)} | ${(s.errorRate * 100).toFixed(2)}% | ${s.held ? 'yes' : '**no**'} |`,
      );
    }
  }
  lines.push('');
  lines.push('## Client-side summary');
  lines.push('');
  lines.push('```');
  lines.push(formatSummary(report.summary, { maxErrors: 15 }));
  lines.push('```');
  for (const server of report.server.metrics) {
    lines.push('');
    lines.push(`## Server: ${server.url}`);
    if (!server.ok) {
      lines.push('');
      lines.push(`Probe failed: ${server.error ?? 'unknown'}`);
      continue;
    }
    lines.push('');
    lines.push(
      `CPU ${server.cpuSeconds === null ? '–' : `${server.cpuSeconds.toFixed(1)} s`}, resident ${server.residentBytes === null ? '–' : `${Math.round(server.residentBytes / 1_048_576)} MiB`}, gauges ${JSON.stringify(server.gauges)}`,
    );
    lines.push('');
    lines.push('| route (backend timing) | mean |');
    lines.push('| --- | --- |');
    for (const r of server.meanSeconds.slice(0, 15)) {
      lines.push(`| \`${r.route}\` | ${ms(r.seconds * 1000)} |`);
    }
  }
  const db = report.server.database;
  if (db !== null) {
    lines.push('');
    lines.push('## Database');
    lines.push('');
    if (!db.ok) {
      lines.push(`Probe failed: ${db.error ?? 'unknown'}`);
    } else {
      lines.push(
        `${db.transactionsPerSecond?.toFixed(0) ?? '–'} transactions/s, ${db.rowsWrittenPerSecond?.toFixed(0) ?? '–'} rows written/s, connections at end ${JSON.stringify(db.connectionsAtEnd)}`,
      );
      lines.push('');
      lines.push('| total | calls/s | mean | statement |');
      lines.push('| --- | --- | --- | --- |');
      for (const s of db.topStatements.slice(0, 20)) {
        lines.push(
          `| ${ms(s.totalMs)} | ${s.callsPerSecond.toFixed(1)} | ${ms(s.meanMs)} | \`${s.query.slice(0, 160).replace(/\|/g, '\\|')}\` |`,
        );
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}
