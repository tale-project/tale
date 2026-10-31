/**
 * The burst's verdict: each expectation of the scenario held against the
 * figure that decides it, and the report people read.
 *
 * A figure that was not observed fails its expectation: the scenario is a
 * proof, and a probe that could not look proves nothing.
 */

import type { OomKill, LogScan } from './probes.ts';
import type { TaskTrack } from './runs.ts';
import { CAPACITY_FAILURE_CODES, newestRun } from './runs.ts';

const GIB = 1024 ** 3;

/** What the burst was asked to do, and on what. */
export interface BurstSettings {
  target: string;
  spawnerUrl: string | null;
  organizationId: string;
  projectId: string;
  agents: number;
  runs: number;
  windowSeconds: number;
  hogMib: number;
  hogSeconds: number;
  /** The project budget the burst set for the organization. */
  projectSessions: number;
  /** The sessions the deployment allows an organization in all. */
  deploymentSessions: number;
  pendingGraceSeconds: number;
  deadlineSeconds: number;
  host: { cpus: number; totalMemoryBytes: number };
}

export interface CreationRecord {
  index: number;
  agentIndex: number;
  /** Milliseconds after the burst began. */
  atMs: number;
  taskId: string | null;
  status: number;
  code: string | null;
}

export interface MemoryFigures {
  samples: number;
  /** Reads of `/proc/meminfo` that failed, and the first failure. */
  errors: number;
  firstError: string | null;
  totalBytes: number | null;
  minAvailableBytes: number | null;
  /** Milliseconds after the burst began. */
  minAtMs: number | null;
}

export interface AdmissionFigures {
  samples: number;
  errors: number;
  firstError: string | null;
  admits: number;
  /** Holds by reason. */
  holds: Record<string, number>;
  /** The reserve memory admission keeps free, as the spawner last said. */
  reserveBytes: number | null;
  minAvailableBytes: number | null;
  maxRunning: number;
  maxStarting: number;
  limit: number | null;
}

export interface HealthFigures {
  path: string;
  probes: number;
  failures: number;
  firstFailure: string | null;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface OomFigures {
  vmstatBefore: number | null;
  vmstatAfter: number | null;
  /** Null when the kernel log was read; else why it could not be. */
  kernelLogError: string | null;
  /** The kills the kernel log stamped inside the burst. */
  kills: OomKill[];
}

/**
 * What the mock provider counted of the hogs the turns ran (`mock/hog.ts`)
 * between a read before the burst and one after it: the calls it sent, and
 * the results that came back from a hog that held its memory and spun to
 * its end.
 */
export interface LoadFigures {
  /** The mock's metrics; null when the burst was given none to read. */
  url: string | null;
  /** Why the counts could not be read; null when both reads gave them. */
  error: string | null;
  calls: number | null;
  results: number | null;
}

export interface BurstObservation {
  settings: BurstSettings;
  startedAt: string;
  durationMs: number;
  /** The deadline passed before every task ended. */
  timedOut: boolean;
  creations: CreationRecord[];
  tasks: TaskTrack[];
  /** The most runs one poll saw running or starting at once. */
  maxConcurrentRuns: number;
  memory: MemoryFigures;
  admission: AdmissionFigures | null;
  health: HealthFigures;
  oom: OomFigures;
  load: LoadFigures;
  /** Null when no log directory was given. */
  logs: LogScan[] | null;
}

export interface Check {
  key: string;
  expectation: string;
  figure: string;
  pass: boolean;
  /** Lines that name what missed. */
  details: string[];
}

export interface BurstReport extends BurstObservation {
  checks: Check[];
  pass: boolean;
}

/** The spawner's default reserve: a tenth of the host, at least 1 GiB. */
export function defaultReserveBytes(totalBytes: number): number {
  return Math.max(GIB, Math.floor(totalBytes / 10));
}

function gib(bytes: number): string {
  return `${(bytes / GIB).toFixed(2)} GiB`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function listTally(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? 'none'
    : entries.map(([key, n]) => `${key} ×${n}`).join(', ');
}

function loadCheck(observation: BurstObservation): Check {
  const { load, settings } = observation;
  const base = {
    key: 'load-applied',
    expectation: "Every run's turn held its memory and kept a CPU busy",
  };
  if (load.calls === null || load.results === null) {
    return {
      ...base,
      figure:
        load.url === null
          ? "not observed: no mock provider's metrics to read"
          : `not observed: no hog counts from ${load.url}`,
      pass: false,
      details: load.error === null ? [] : [load.error],
    };
  }
  const pass = load.results >= settings.runs;
  const details: string[] = [];
  if (!pass && load.calls < settings.runs) {
    details.push(
      `${settings.runs - load.calls} of ${settings.runs} runs' turns got no hog call: the mock saw no shell tool or no [[mock:hog]] in them, or the run never reached its turn`,
    );
  }
  if (!pass && load.results < load.calls) {
    details.push(
      `${load.calls - load.results} hog calls brought back no hog that ran to its end: the command failed or was killed, or its turn ended first`,
    );
  }
  return {
    ...base,
    figure: `${load.results} hogs ran to their end for ${settings.runs} runs; ${load.calls} hog calls sent`,
    pass,
    details,
  };
}

function hostOomCheck(oom: OomFigures): Check {
  const delta =
    oom.vmstatBefore === null || oom.vmstatAfter === null
      ? null
      : oom.vmstatAfter - oom.vmstatBefore;
  const host = oom.kills.filter((kill) => kill.scope === 'host');
  const cgroup = oom.kills.length - host.length;
  const vmstat =
    delta === null ? 'vmstat unreadable' : `vmstat oom_kill +${delta}`;
  const base = {
    key: 'host-oom',
    expectation: 'No host-wide OOM kill',
  };
  if (oom.kernelLogError === null) {
    return {
      ...base,
      figure: `${host.length} host-wide, ${cgroup} inside session cgroups (${vmstat})`,
      pass: host.length === 0,
      details: host.map((kill) => kill.line),
    };
  }
  return {
    ...base,
    figure:
      delta === 0
        ? `no OOM kill at all (${vmstat}); kernel log unreadable`
        : `${delta === null ? 'unknown' : delta} OOM kills (${vmstat}); kernel log unreadable, so host-wide ones cannot be told apart`,
    pass: delta === 0,
    details: [`kernel log: ${oom.kernelLogError}`],
  };
}

function memoryCheck(observation: BurstObservation): Check {
  const { memory, admission } = observation;
  const spawnerReserve = admission?.reserveBytes ?? null;
  const total = memory.totalBytes;
  const reserve =
    spawnerReserve ?? (total === null ? null : defaultReserveBytes(total));
  const source = spawnerReserve === null ? 'default' : 'spawner';
  const base = {
    key: 'memory-reserve',
    expectation: "Available memory stays above the spawner's reserve",
  };
  if (memory.minAvailableBytes === null || reserve === null) {
    return {
      ...base,
      figure: 'not observed: no reading of the host memory',
      pass: false,
      details: memory.firstError === null ? [] : [memory.firstError],
    };
  }
  return {
    ...base,
    figure: `lowest ${gib(memory.minAvailableBytes)} available${memory.minAtMs === null ? '' : ` at +${seconds(memory.minAtMs)}`}; reserve ${gib(reserve)} (${source}); ${memory.samples} samples`,
    pass: memory.minAvailableBytes > reserve,
    details: [],
  };
}

function poolCheck(logs: LogScan[] | null): Check {
  const base = {
    key: 'pool-timeouts',
    expectation: 'No database pool connection timeouts',
  };
  if (logs === null || logs.length === 0) {
    return {
      ...base,
      figure: 'not observed: no api or worker log to scan',
      pass: false,
      details: [],
    };
  }
  let total = 0;
  const details: string[] = [];
  for (const scan of logs) {
    const count = Object.values(scan.counts).reduce((a, b) => a + b, 0);
    total += count;
    if (count > 0) {
      details.push(`${scan.path}: ${listTally(scan.counts)}`);
      details.push(...scan.examples.map((line) => `  ${line}`));
    }
  }
  return {
    ...base,
    figure: `${total} in ${logs.length} process logs`,
    pass: total === 0,
    details,
  };
}

function healthCheck(health: HealthFigures): Check {
  const base = {
    key: 'health-p95',
    expectation: `\`${health.path}\` p95 under 1 s`,
  };
  if (health.probes === 0) {
    return {
      ...base,
      figure: 'not observed: no probe ran',
      pass: false,
      details: [],
    };
  }
  return {
    ...base,
    figure: `p95 ${Math.round(health.p95Ms)} ms (p50 ${Math.round(health.p50Ms)}, p99 ${Math.round(health.p99Ms)}, max ${Math.round(health.maxMs)}); ${health.failures} of ${health.probes} probes failed`,
    pass: health.failures === 0 && health.p95Ms < 1000,
    details:
      health.firstFailure === null
        ? []
        : [`first failure: ${health.firstFailure}`],
  };
}

function visibleWaitCheck(observation: BurstObservation): Check {
  const graceMs = observation.settings.pendingGraceSeconds * 1000;
  const details: string[] = [];
  const reasons: string[] = [];
  let waited = 0;
  for (const task of observation.tasks) {
    if (task.runs.length === 0 && task.longestWithoutRunMs > graceMs) {
      details.push(
        `${task.title}: in progress for ${seconds(task.longestWithoutRunMs)} without a run`,
      );
    }
    for (const run of task.runs) {
      if (run.reasons.length > 0 || run.parkedWithoutReason > 0) waited += 1;
      reasons.push(...run.reasons);
      if (run.parkedWithoutReason > 0) {
        details.push(
          `${task.title}, run ${run.id}: parked with no reason in ${run.parkedWithoutReason} polls`,
        );
      }
      if (run.longestPendingMs > graceMs) {
        details.push(
          `${task.title}, run ${run.id}: queued for ${seconds(run.longestPendingMs)} neither parked nor starting`,
        );
      }
    }
  }
  return {
    key: 'visible-waits',
    expectation: 'Runs beyond the room wait with a visible reason',
    figure: `${waited} runs waited (${listTally(tally(reasons))}); ${details.length} waits without a reason`,
    pass: details.length === 0,
    details,
  };
}

function capacityCheck(observation: BurstObservation): Check {
  const details: string[] = [];
  for (const task of observation.tasks) {
    for (const run of task.runs) {
      if (run.place !== 'failed') continue;
      if (
        run.failureCode === null ||
        !CAPACITY_FAILURE_CODES.has(run.failureCode)
      ) {
        continue;
      }
      details.push(
        `${task.title}, run ${run.id}: ${run.failureCode}${run.error === null ? '' : ` — ${run.error.slice(0, 300)}`}`,
      );
    }
  }
  return {
    key: 'capacity-failures',
    expectation: 'No run fails for lack of capacity',
    figure: `${details.length} runs failed for capacity`,
    pass: details.length === 0,
    details,
  };
}

function completionCheck(observation: BurstObservation): Check {
  const details: string[] = [];
  let settled = 0;
  let failedRuns = 0;
  for (const creation of observation.creations) {
    if (creation.taskId === null) {
      details.push(
        `task ${creation.index + 1}: not created (HTTP ${creation.status}${creation.code === null ? '' : ` ${creation.code}`})`,
      );
    }
  }
  for (const task of observation.tasks) {
    for (const run of task.runs) {
      if (run.place !== 'failed') continue;
      failedRuns += 1;
      details.push(
        `${task.title}, run ${run.id}: failed ${run.failureCode ?? 'without a code'}${run.error === null ? '' : ` — ${run.error.slice(0, 300)}`}`,
      );
    }
    const newest = newestRun(task);
    if (task.doneAtMs !== null && newest?.place === 'settled') {
      settled += 1;
    } else if (task.doneAtMs === null) {
      details.push(
        `${task.title}: not finished at the end (${newest === null ? 'no run' : newest.place})`,
      );
    } else if (newest !== null && newest.place === 'cancelled') {
      details.push(`${task.title}: its last run was cancelled`);
    }
  }
  return {
    key: 'runs-complete',
    expectation: 'Every run of the burst ends settled',
    figure: `${settled} of ${observation.settings.runs} tasks settled; ${failedRuns} failed runs${observation.timedOut ? '; the deadline passed' : ''}`,
    pass:
      settled === observation.settings.runs &&
      failedRuns === 0 &&
      !observation.timedOut,
    details,
  };
}

/** Hold every expectation against its figure. */
export function judgeBurst(observation: BurstObservation): BurstReport {
  const checks = [
    loadCheck(observation),
    hostOomCheck(observation.oom),
    memoryCheck(observation),
    poolCheck(observation.logs),
    healthCheck(observation.health),
    visibleWaitCheck(observation),
    capacityCheck(observation),
    completionCheck(observation),
  ];
  return {
    ...observation,
    checks,
    pass: checks.every((check) => check.pass),
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** How much of a run's answer the runs table shows. */
const ANSWER_CHARS = 120;

/** The start of a run's answer, on one line; a dash when it gave none. */
function answerExcerpt(text: string | null): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '–';
  return flat.length > ANSWER_CHARS ? `${flat.slice(0, ANSWER_CHARS)}…` : flat;
}

/** The report for people: the verdict, each figure, and what missed. */
export function renderBurstMarkdown(report: BurstReport): string {
  const { settings } = report;
  const lines: string[] = [];
  const missed = report.checks.filter((check) => !check.pass).length;
  lines.push(
    `# Agent-run burst: ${settings.runs} runs across ${settings.agents} agents in ${settings.windowSeconds} s — ${report.pass ? 'PASSED' : 'FAILED'}`,
  );
  lines.push('');
  lines.push(
    report.pass
      ? 'Every expectation held.'
      : `${missed} of ${report.checks.length} expectations missed.`,
  );
  lines.push('');
  lines.push('| expectation | figure | result |');
  lines.push('| --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(
      `| ${cell(check.expectation)} | ${cell(check.figure)} | ${check.pass ? 'held' : '**missed**'} |`,
    );
  }
  lines.push('');
  lines.push('## Setup');
  lines.push('');
  lines.push(
    `- Host: ${settings.host.cpus} CPUs, ${gib(settings.host.totalMemoryBytes)} memory`,
  );
  lines.push(
    `- Target ${settings.target}; spawner ${settings.spawnerUrl ?? 'not watched'}`,
  );
  lines.push(
    `- Organization \`${settings.organizationId}\`, project \`${settings.projectId}\`; project budget ${settings.projectSessions} of the deployment's ${settings.deploymentSessions} sessions`,
  );
  lines.push(
    `- Each run's turn holds ${settings.hogMib} MiB and keeps a CPU busy for ${settings.hogSeconds} s; ${report.load.url === null ? "no mock provider's hog counts were read" : `the mock provider counts its hogs at ${report.load.url}`}`,
  );
  lines.push(
    `- ${report.startedAt}, ${seconds(report.durationMs)}; most runs at once: ${report.maxConcurrentRuns}`,
  );
  for (const check of report.checks) {
    if (check.details.length === 0) continue;
    lines.push('');
    lines.push(`## ${check.expectation}`);
    lines.push('');
    lines.push('```');
    lines.push(...check.details);
    lines.push('```');
  }
  lines.push('');
  lines.push('## Runs');
  lines.push('');
  lines.push('| task | agent | created | runs | waited for | ended | answer |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  const startMs = Date.parse(report.startedAt);
  for (const task of report.tasks) {
    const newest = newestRun(task);
    const reasons = [...new Set(task.runs.flatMap((run) => run.reasons))];
    const parkedMs = task.runs.reduce((sum, run) => sum + run.parkedMs, 0);
    lines.push(
      `| ${cell(task.title)} | ${task.agentIndex + 1} | +${seconds(task.createdAtMs - startMs)} | ${task.runs.length} | ${reasons.length === 0 ? '–' : `${cell(reasons.join(', '))} (${seconds(parkedMs)})`} | ${newest === null ? 'no run' : newest.place}${newest?.failureCode == null ? '' : ` (${newest.failureCode})`}${task.doneAtMs === null ? '' : ` at +${seconds(task.doneAtMs - startMs)}`} | ${cell(answerExcerpt(newest?.resultText ?? null))} |`,
    );
  }
  if (report.admission !== null) {
    const a = report.admission;
    lines.push('');
    lines.push('## Spawner admission');
    lines.push('');
    lines.push(
      `- ${a.samples} answers: ${a.admits} admit, holds ${listTally(a.holds)}; ${a.errors} unanswered${a.firstError === null ? '' : ` (first: ${a.firstError})`}`,
    );
    lines.push(
      `- Sessions: most running ${a.maxRunning}, most starting ${a.maxStarting}, limit ${a.limit ?? 'unknown'}`,
    );
    lines.push(
      `- Memory it saw: lowest ${a.minAvailableBytes === null ? 'unknown' : gib(a.minAvailableBytes)} available, reserve ${a.reserveBytes === null ? 'unknown' : gib(a.reserveBytes)}`,
    );
  }
  if (report.oom.kills.length > 0) {
    lines.push('');
    lines.push('## Kernel OOM kills during the burst');
    lines.push('');
    lines.push('```');
    lines.push(...report.oom.kills.slice(0, 50).map((kill) => kill.line));
    lines.push('```');
  }
  lines.push('');
  return lines.join('\n');
}
