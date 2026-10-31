/**
 * The agent-run burst: hand tasks to a project's agents within a short
 * window, on the host that carries the platform and its sandboxes, and
 * watch until every run has ended — what the board showed of each run, and
 * what the host went through meanwhile.
 *
 * Setup is the organization's owner doing what a person would: sign in,
 * give the project a sandbox budget the host (not the quota) must hold
 * back, and create the agents. Then each task is created in progress and
 * assigned to its agent, which is what starts its run. The run's turn is
 * the mock provider's: its description asks for a command that holds memory
 * and a CPU for a while (`mock/hog.ts`).
 *
 * Meanwhile four probes sample the host: its available memory, the
 * spawner's admission answer, the platform's readiness door and, after the
 * burst, the kernel's OOM kills and the platform's logs. The mock's hog
 * counts, read before and after, say whether the turns applied their load.
 */

import { readFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';

import {
  ApiClient,
  asNumber,
  asRecord,
  asString,
  orgQuery,
  rowsOf,
} from '../api/client.ts';
import { createTask } from '../api/tasks.ts';
import { HttpClient, UserSession, createAgent } from '../client/index.ts';
import { LatencyHistogram, MetricsRegistry } from '../metrics/index.ts';
import { HOG_CALLS_METRIC, HOG_RESULTS_METRIC } from '../mock/metrics.ts';
import type { LoadPlan, PlanOrganization } from '../plan.ts';
import { userEmail } from '../plan.ts';
import { scrapeMetrics } from '../runner/probes.ts';
import type { OomKill } from './probes.ts';
import {
  parseMeminfo,
  parseOomKills,
  parseUptime,
  parseVmstatOomKills,
  readKernelLog,
  scanLog,
  sizeOf,
} from './probes.ts';
import type {
  AdmissionFigures,
  BurstObservation,
  BurstReport,
  BurstSettings,
  CreationRecord,
  HealthFigures,
  LoadFigures,
  MemoryFigures,
} from './report.ts';
import { judgeBurst } from './report.ts';
import type { TaskTrack } from './runs.ts';
import {
  closeStretch,
  isTerminal,
  listRuns,
  newestRun,
  observeTask,
  retryPending,
} from './runs.ts';
import { readAdmission } from './spawner.ts';

/** What the platform logs when a request waited too long for a pool slot. */
export const POOL_TIMEOUT_PATTERNS: Readonly<Record<string, RegExp>> = {
  'pool connect timeout': /timeout exceeded when trying to connect/i,
  CONNECT_TIMEOUT: /\bCONNECT_TIMEOUT\b/,
  'connection timeout': /Connection terminated due to connection timeout/i,
};

/** The readiness door: it answers once the process can serve. */
const HEALTH_PATH = '/api/health/ready';

/** Where the host's figures are read. Tests point them at fixtures. */
export interface HostProbes {
  meminfo: string;
  vmstat: string;
  uptime: string;
  readKernelLog: () => Promise<
    { ok: true; text: string } | { ok: false; error: string }
  >;
  cpus: number;
  totalMemoryBytes: number;
}

function hostProbes(): HostProbes {
  return {
    meminfo: '/proc/meminfo',
    vmstat: '/proc/vmstat',
    uptime: '/proc/uptime',
    readKernelLog,
    cpus: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

export interface BurstIntervals {
  pollMs: number;
  memoryMs: number;
  admissionMs: number;
  healthMs: number;
  healthTimeoutMs: number;
}

const DEFAULT_INTERVALS: BurstIntervals = {
  pollMs: 2_000,
  memoryMs: 1_000,
  admissionMs: 2_000,
  healthMs: 250,
  healthTimeoutMs: 5_000,
};

export interface BurstOptions {
  plan: LoadPlan;
  /** The api the owner signs in to. */
  target: string;
  /** The spawner's base URL, to read its admission answer; null: do not. */
  spawnerUrl: string | null;
  /** The spawner's `SANDBOX_TOKEN`, which signs the admission read. */
  spawnerToken: string | null;
  harness: string;
  agents: number;
  runs: number;
  windowSeconds: number;
  hogMib: number;
  hogSeconds: number;
  /** The project budget to set; null: the deployment's room minus three. */
  projectSessions: number | null;
  pendingGraceSeconds: number;
  deadlineSeconds: number;
  /** The api and worker logs to scan for pool timeouts; null: none. */
  logFiles: string[] | null;
  /**
   * The mock provider's `/metrics`, whose hog counts show the load the
   * turns applied; null: not read.
   */
  mockMetricsUrl: string | null;
  intervals?: Partial<BurstIntervals>;
  probes?: HostProbes;
  /** Progress lines; `console.log` when absent. */
  log?: (line: string) => void;
}

/** The burst could not be set up: it observed nothing. */
export class BurstSetupError extends Error {
  override name = 'BurstSetupError';
}

const AGENT_NAME_PREFIX = 'Burst agent';
const TASK_TITLE_PREFIX = 'Burst run';

function sleep(ms: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, Math.max(0, ms)));
}

/**
 * The budget the burst gives the project: the largest the organization may
 * set, the deployment's room but one session for each of its three other
 * budgets (an organization's budgets add up to at most the room). Runs
 * beyond it wait for the organization's quota.
 */
function defaultProjectSessions(limits: {
  maxSessions: number;
  deviceSessions: number;
}): number {
  return Math.min(
    500,
    Math.max(1, limits.maxSessions + limits.deviceSessions - 3),
  );
}

/** The description that makes the mock's turn hold memory and a CPU. */
function burstTaskDescription(hogMib: number, hogSeconds: number): string {
  return [
    'A run of the agent-run burst (tools/load). Its turn runs one command that holds memory and keeps a CPU busy, then ends.',
    '',
    `[[mock:hog=${hogMib}]] [[mock:hog-seconds=${hogSeconds}]]`,
  ].join('\n');
}

async function signInOwner(
  options: BurstOptions,
  org: PlanOrganization,
  agent: ReturnType<typeof createAgent>,
  metrics: MetricsRegistry,
): Promise<UserSession> {
  const owner = new UserSession({
    baseUrl: options.target,
    agent,
    metrics,
    email: userEmail(options.plan, org.ownerIndex),
    password: options.plan.users.password,
    orgId: org.id,
    orgSlug: org.slug,
  });
  const signedIn = await owner.signIn();
  if (!signedIn.ok) {
    throw new BurstSetupError(
      `signing in as the owner of ${org.slug} failed: HTTP ${signedIn.status}${signedIn.twoFactorRedirect === true ? ', a second factor was asked' : ''}`,
    );
  }
  const active = await owner.setActiveOrganization(org.id);
  if (!active.ok) {
    throw new BurstSetupError(
      `making ${org.slug} the active organization failed: HTTP ${active.status}`,
    );
  }
  return owner;
}

/** The deployment's sandbox room, as the settings page reads it. */
async function readSandboxLimits(
  api: ApiClient,
  orgId: string,
): Promise<{ maxSessions: number; deviceSessions: number }> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: '/api/app/sandbox/limits',
    query: orgQuery(orgId),
    name: 'GET /api/app/sandbox/limits',
  });
  const body = asRecord(result.body);
  if (!result.ok || body === undefined) {
    throw new BurstSetupError(
      `the sandbox limits door answered HTTP ${result.status}`,
    );
  }
  if (body.status !== 'available') {
    throw new BurstSetupError(
      `the deployment has no sandbox to start runs in: ${asString(body.reason) ?? 'unavailable'}`,
    );
  }
  const maxSessions = asNumber(body.maxSessions);
  if (maxSessions === undefined) {
    throw new BurstSetupError('the sandbox limits door named no maxSessions');
  }
  return { maxSessions, deviceSessions: asNumber(body.deviceSessions) ?? 0 };
}

/** Save the organization's sandbox quota with `projectSessions` for agents. */
async function writeSandboxQuota(
  api: ApiClient,
  orgId: string,
  projectSessions: number,
): Promise<void> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/governance/policies/sandbox_quota',
    query: orgQuery(orgId),
    json: {
      config: {
        maxSessionsPerOrg: projectSessions,
        maxWorkflowSessionsPerOrg: 1,
        maxRenderSessionsPerOrg: 1,
        maxLightSessionsPerOrg: 1,
      },
    },
    name: 'POST /api/app/governance/policies/:key',
    refusals: [400, 403, 409, 422],
  });
  if (!result.ok) {
    throw new BurstSetupError(
      `saving the sandbox quota failed: HTTP ${result.status}${result.code === undefined ? '' : ` ${result.code}`}`,
    );
  }
}

async function listAgentIds(
  api: ApiClient,
  orgId: string,
  projectId: string,
): Promise<Map<string, string>> {
  const result = await api.call<unknown>({
    method: 'GET',
    path: `/api/app/projects/${encodeURIComponent(projectId)}/agents`,
    query: orgQuery(orgId),
    name: 'GET /api/app/projects/:id/agents',
  });
  const byName = new Map<string, string>();
  for (const row of rowsOf(result.body, 'agents')) {
    const id = asString(row.id);
    const name = asString(row.name);
    if (id !== undefined && name !== undefined) byName.set(name, id);
  }
  return byName;
}

/**
 * The burst's agents, created on first use: a re-run against the same
 * deployment finds them by name instead.
 */
async function ensureAgents(
  api: ApiClient,
  org: {
    id: string;
    projectId: string;
    modelId: string;
    providerSlug: string | null;
  },
  count: number,
  harness: string,
): Promise<string[]> {
  const ids: string[] = [];
  let existing: Map<string, string> | null = null;
  for (let index = 0; index < count; index += 1) {
    const name = `${AGENT_NAME_PREFIX} ${index + 1}`;
    const created = await api.call<unknown>({
      method: 'POST',
      path: `/api/app/projects/${encodeURIComponent(org.projectId)}/agents`,
      query: orgQuery(org.id),
      json: {
        name,
        harness,
        model: org.modelId,
        ...(org.providerSlug === null
          ? {}
          : { modelProvider: org.providerSlug }),
        skills: [],
        connectors: [],
      },
      name: 'POST /api/app/projects/:id/agents',
      refusals: [409],
    });
    const agentId = asString(asRecord(created.body)?.agentId);
    if (created.ok && agentId !== undefined) {
      ids.push(agentId);
      continue;
    }
    if (created.status === 409) {
      existing ??= await listAgentIds(api, org.id, org.projectId);
      const found = existing.get(name);
      if (found !== undefined) {
        ids.push(found);
        continue;
      }
    }
    throw new BurstSetupError(
      `creating agent "${name}" failed: HTTP ${created.status}${created.code === undefined ? '' : ` ${created.code}`}`,
    );
  }
  return ids;
}

interface Sampler {
  stop: () => Promise<void>;
}

/** Wait `ms`, or less when `signal` aborts first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Run `tick` every `intervalMs` until stopped; ticks never overlap. */
function every(intervalMs: number, tick: () => Promise<void>): Sampler {
  const stopping = new AbortController();
  const loop = (async () => {
    while (!stopping.signal.aborted) {
      const began = Date.now();
      try {
        await tick();
      } catch (error) {
        console.warn('[burst] a probe failed:', error);
      }
      await pause(intervalMs - (Date.now() - began), stopping.signal);
    }
  })();
  return {
    stop: async () => {
      stopping.abort();
      await loop;
    },
  };
}

/** Where a probe's failures go: counted, and the first one kept. */
interface ProbeErrors {
  errors: number;
  firstError: string | null;
}

function noteError(errors: ProbeErrors, message: string): void {
  errors.errors += 1;
  if (errors.firstError === null) {
    errors.firstError = message;
    console.warn(`[burst] ${message}`);
  }
}

async function readProbe(
  path: string,
  errors: ProbeErrors,
): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    noteError(
      errors,
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function memorySampler(
  probes: HostProbes,
  intervalMs: number,
  startMs: number,
): { figures: MemoryFigures; sampler: Sampler } {
  const figures: MemoryFigures = {
    samples: 0,
    errors: 0,
    firstError: null,
    totalBytes: null,
    minAvailableBytes: null,
    minAtMs: null,
  };
  const sampler = every(intervalMs, async () => {
    const text = await readProbe(probes.meminfo, figures);
    if (text === null) return;
    const memory = parseMeminfo(text);
    if (memory === null) {
      noteError(figures, `${probes.meminfo} has no MemTotal or MemAvailable`);
      return;
    }
    figures.samples += 1;
    figures.totalBytes = memory.totalBytes;
    if (
      figures.minAvailableBytes === null ||
      memory.availableBytes < figures.minAvailableBytes
    ) {
      figures.minAvailableBytes = memory.availableBytes;
      figures.minAtMs = Date.now() - startMs;
    }
  });
  return { figures, sampler };
}

function admissionSampler(
  spawner: HttpClient,
  token: string,
  organizationId: string,
  intervalMs: number,
): { figures: AdmissionFigures; sampler: Sampler } {
  const figures: AdmissionFigures = {
    samples: 0,
    errors: 0,
    firstError: null,
    admits: 0,
    holds: {},
    reserveBytes: null,
    minAvailableBytes: null,
    maxRunning: 0,
    maxStarting: 0,
    limit: null,
  };
  const sampler = every(intervalMs, async () => {
    const read = await readAdmission(spawner, token, organizationId);
    if (!read.ok) {
      noteError(figures, `the spawner's admission door: ${read.error}`);
      return;
    }
    const { sample } = read;
    figures.samples += 1;
    if (sample.verdict === 'admit') {
      figures.admits += 1;
    } else {
      const reason = sample.reason ?? 'unnamed';
      figures.holds[reason] = (figures.holds[reason] ?? 0) + 1;
    }
    if (sample.memory !== null) {
      figures.reserveBytes = sample.memory.reserveBytes;
      figures.minAvailableBytes = Math.min(
        figures.minAvailableBytes ?? Number.POSITIVE_INFINITY,
        sample.memory.availableBytes,
      );
    }
    figures.maxRunning = Math.max(figures.maxRunning, sample.sessions.running);
    figures.maxStarting = Math.max(
      figures.maxStarting,
      sample.sessions.starting,
    );
    figures.limit = sample.sessions.limit;
  });
  return { figures, sampler };
}

function healthSampler(
  client: HttpClient,
  intervals: BurstIntervals,
): { read: () => HealthFigures; sampler: Sampler } {
  const latency = new LatencyHistogram();
  const errors: ProbeErrors = { errors: 0, firstError: null };
  let probes = 0;
  const sampler = every(intervals.healthMs, async () => {
    const response = await client.request({
      method: 'GET',
      path: HEALTH_PATH,
      name: `GET ${HEALTH_PATH}`,
      timeoutMs: intervals.healthTimeoutMs,
    });
    probes += 1;
    latency.record(response.ms);
    if (!response.ok) {
      noteError(
        errors,
        `${HEALTH_PATH} ${response.status === 0 ? `gave no answer (${response.errorKind ?? 'unknown'})` : `answered HTTP ${response.status}`} after ${Math.round(response.ms)} ms`,
      );
    }
  });
  return {
    sampler,
    read: () => ({
      path: HEALTH_PATH,
      probes,
      failures: errors.errors,
      firstFailure: errors.firstError,
      p50Ms: latency.percentile(50),
      p95Ms: latency.percentile(95),
      p99Ms: latency.percentile(99),
      maxMs: latency.max,
    }),
  };
}

/** The organization the burst drives: the plan's first, with a project. */
function burstOrganization(plan: LoadPlan): {
  org: PlanOrganization;
  projectId: string;
  modelId: string;
} {
  const org = plan.organizations.list[0];
  if (org === undefined) {
    throw new BurstSetupError('the plan holds no organization');
  }
  if (org.projectId === null || org.modelId === null) {
    throw new BurstSetupError(
      `organization ${org.slug} has no ${org.projectId === null ? 'project' : 'model'}: seed it with a provider`,
    );
  }
  return { org, projectId: org.projectId, modelId: org.modelId };
}

function placeCounts(tasks: readonly TaskTrack[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    const place = newestRun(task)?.place ?? 'no run';
    counts[place] = (counts[place] ?? 0) + 1;
  }
  return counts;
}

function activeRuns(tasks: readonly TaskTrack[]): number {
  let active = 0;
  for (const task of tasks) {
    for (const run of task.runs) {
      if (run.place === 'running' || run.place === 'starting') active += 1;
    }
  }
  return active;
}

/** One poll of every task still open: fold its runs, note when it ended. */
async function pollTasks(
  api: ApiClient,
  orgId: string,
  tasks: readonly TaskTrack[],
): Promise<void> {
  await Promise.all(
    tasks
      .filter((task) => task.doneAtMs === null)
      .map(async (task) => {
        const rows = await listRuns(api, orgId, task.taskId);
        const nowMs = Date.now();
        if (rows === null) return;
        observeTask(task, rows, nowMs);
        const newest = newestRun(task);
        if (newest === null || !isTerminal(newest.place)) return;
        // A failed run the platform will retry is not the task's end: the
        // retry's run follows on the next polls.
        if (
          newest.place === 'failed' &&
          (await retryPending(api, orgId, task.taskId)) !== false
        ) {
          return;
        }
        task.doneAtMs = nowMs;
      }),
  );
}

/**
 * Create the burst's tasks on schedule: task `i` at `i × window / runs`,
 * each fired on time whether or not the one before it has been answered.
 */
async function createBurstTasks(
  api: ApiClient,
  orgId: string,
  projectId: string,
  agentIds: readonly string[],
  options: BurstOptions,
  startMs: number,
  tasks: TaskTrack[],
  creations: CreationRecord[],
): Promise<void> {
  const description = burstTaskDescription(options.hogMib, options.hogSeconds);
  const createOne = async (index: number): Promise<void> => {
    const agentIndex = index % agentIds.length;
    const title = `${TASK_TITLE_PREFIX} ${index + 1}`;
    const atMs = Date.now();
    const result = await createTask(api, orgId, {
      projectId,
      title,
      description,
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeId: agentIds[agentIndex],
    });
    creations.push({
      index,
      agentIndex,
      atMs: atMs - startMs,
      taskId: result.body ?? null,
      status: result.status,
      code: result.code ?? null,
    });
    if (result.body === undefined) return;
    tasks.push({
      taskId: result.body,
      title,
      agentIndex,
      createdAtMs: atMs,
      runs: [],
      doneAtMs: null,
      longestWithoutRunMs: 0,
    });
  };
  const pending: Promise<void>[] = [];
  for (let index = 0; index < options.runs; index += 1) {
    const dueMs =
      startMs +
      Math.floor((index * options.windowSeconds * 1000) / options.runs);
    await sleep(dueMs - Date.now());
    pending.push(createOne(index));
  }
  await Promise.all(pending);
  creations.sort((a, b) => a.index - b.index);
  tasks.sort((a, b) => a.createdAtMs - b.createdAtMs);
}

type HogCounts =
  | { ok: true; calls: number; results: number }
  | { ok: false; error: string };

/** The mock's hog counts now, or why they could not be read. */
async function readHogCounts(url: string): Promise<HogCounts> {
  const scrape = await scrapeMetrics({ url });
  if (!scrape.ok) {
    return {
      ok: false,
      error: `${url} did not answer: ${scrape.error ?? 'no reason'}`,
    };
  }
  const total = (name: string): number | undefined =>
    scrape.samples.find((sample) => sample.name === name)?.value;
  const calls = total(HOG_CALLS_METRIC);
  const results = total(HOG_RESULTS_METRIC);
  if (calls === undefined || results === undefined) {
    return {
      ok: false,
      error: `${url} counts no hogs: it is not the load mock's metrics`,
    };
  }
  return { ok: true, calls, results };
}

/** What the mock counted between a read before the burst and one after. */
function loadFigures(
  url: string | null,
  before: HogCounts | null,
  after: HogCounts | null,
): LoadFigures {
  const unread = (error: string | null): LoadFigures => ({
    url,
    error,
    calls: null,
    results: null,
  });
  if (url === null || before === null || after === null) return unread(null);
  if (!before.ok) return unread(before.error);
  if (!after.ok) return unread(after.error);
  if (after.calls < before.calls || after.results < before.results) {
    return unread(
      `the hog counts at ${url} went down: the mock restarted during the burst`,
    );
  }
  return {
    url,
    error: null,
    calls: after.calls - before.calls,
    results: after.results - before.results,
  };
}

function gibText(bytes: number | null): string {
  return bytes === null ? '?' : `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** Run the burst and judge it. Throws {@link BurstSetupError} on setup. */
export async function runBurst(options: BurstOptions): Promise<BurstReport> {
  const log = options.log ?? ((line: string) => console.log(line));
  const intervals = { ...DEFAULT_INTERVALS, ...options.intervals };
  const probes = options.probes ?? hostProbes();
  const { org, projectId, modelId } = burstOrganization(options.plan);
  const metrics = new MetricsRegistry({ retentionMs: 60_000 });
  const agent = createAgent();
  try {
    const owner = await signInOwner(options, org, agent, metrics);
    const api = new ApiClient({ requester: owner });
    const limits = await readSandboxLimits(api, org.id);
    const projectSessions =
      options.projectSessions ?? defaultProjectSessions(limits);
    await writeSandboxQuota(api, org.id, projectSessions);
    const agentIds = await ensureAgents(
      api,
      { id: org.id, projectId, modelId, providerSlug: org.providerSlug },
      options.agents,
      options.harness,
    );
    const deploymentSessions = limits.maxSessions + limits.deviceSessions;
    log(
      `[burst] ${agentIds.length} agents ready; the project may hold ${projectSessions} of the deployment's ${deploymentSessions} sessions`,
    );
    const settings: BurstSettings = {
      target: options.target,
      spawnerUrl: options.spawnerUrl,
      organizationId: org.id,
      projectId,
      agents: agentIds.length,
      runs: options.runs,
      windowSeconds: options.windowSeconds,
      hogMib: options.hogMib,
      hogSeconds: options.hogSeconds,
      projectSessions,
      deploymentSessions,
      pendingGraceSeconds: options.pendingGraceSeconds,
      deadlineSeconds: options.deadlineSeconds,
      host: { cpus: probes.cpus, totalMemoryBytes: probes.totalMemoryBytes },
    };

    const baseline: ProbeErrors = { errors: 0, firstError: null };
    const vmstatBefore = parseVmstatOomKills(
      (await readProbe(probes.vmstat, baseline)) ?? '',
    );
    const uptimeBefore = parseUptime(
      (await readProbe(probes.uptime, baseline)) ?? '',
    );
    const offsets = new Map<string, number>();
    for (const file of options.logFiles ?? []) {
      offsets.set(file, await sizeOf(file));
    }
    const hogsBefore =
      options.mockMetricsUrl === null
        ? null
        : await readHogCounts(options.mockMetricsUrl);

    const startMs = Date.now();
    const memory = memorySampler(probes, intervals.memoryMs, startMs);
    const admission =
      options.spawnerUrl === null || options.spawnerToken === null
        ? null
        : admissionSampler(
            new HttpClient({ baseUrl: options.spawnerUrl, agent, metrics }),
            options.spawnerToken,
            org.id,
            intervals.admissionMs,
          );
    const health = healthSampler(
      new HttpClient({ baseUrl: options.target, agent, metrics }),
      intervals,
    );

    const tasks: TaskTrack[] = [];
    const creations: CreationRecord[] = [];
    // A request never throws, so neither does the creation: it needs no
    // handler while the poll loop below runs.
    let created = false;
    const creating = (async () => {
      await createBurstTasks(
        api,
        org.id,
        projectId,
        agentIds,
        options,
        startMs,
        tasks,
        creations,
      );
      created = true;
    })();
    const deadlineMs = startMs + options.deadlineSeconds * 1000;
    let maxConcurrentRuns = 0;
    let timedOut = false;
    let lastProgressMs = startMs;
    for (;;) {
      await sleep(intervals.pollMs);
      await pollTasks(api, org.id, tasks);
      maxConcurrentRuns = Math.max(maxConcurrentRuns, activeRuns(tasks));
      const nowMs = Date.now();
      if (created && tasks.every((task) => task.doneAtMs !== null)) break;
      if (nowMs >= deadlineMs) {
        timedOut = true;
        break;
      }
      if (nowMs - lastProgressMs >= 10_000) {
        lastProgressMs = nowMs;
        const places = Object.entries(placeCounts(tasks))
          .map(([place, n]) => `${n} ${place}`)
          .join(', ');
        log(
          `[burst] +${Math.round((nowMs - startMs) / 1000)} s: ${tasks.length} tasks (${places}); lowest available memory ${gibText(memory.figures.minAvailableBytes)}`,
        );
      }
    }
    await creating;
    const endMs = Date.now();
    for (const task of tasks) {
      for (const run of task.runs) closeStretch(run, endMs);
      if (task.runs.length === 0 && task.doneAtMs === null) {
        task.longestWithoutRunMs = Math.max(
          task.longestWithoutRunMs,
          endMs - task.createdAtMs,
        );
      }
    }
    await Promise.all([
      memory.sampler.stop(),
      admission?.sampler.stop(),
      health.sampler.stop(),
    ]);
    const hogsAfter =
      options.mockMetricsUrl === null
        ? null
        : await readHogCounts(options.mockMetricsUrl);

    const vmstatAfter = parseVmstatOomKills(
      (await readProbe(probes.vmstat, baseline)) ?? '',
    );
    const kernelLog = await probes.readKernelLog();
    const kills: OomKill[] = kernelLog.ok
      ? parseOomKills(kernelLog.text).filter(
          (kill) => uptimeBefore === null || kill.atSeconds >= uptimeBefore,
        )
      : [];
    const logs =
      options.logFiles === null
        ? null
        : await Promise.all(
            options.logFiles.map((file) =>
              scanLog(file, offsets.get(file) ?? 0, POOL_TIMEOUT_PATTERNS),
            ),
          );

    const observation: BurstObservation = {
      settings,
      startedAt: new Date(startMs).toISOString(),
      durationMs: endMs - startMs,
      timedOut,
      creations,
      tasks,
      maxConcurrentRuns,
      memory: memory.figures,
      admission: admission?.figures ?? null,
      health: health.read(),
      oom: {
        vmstatBefore,
        vmstatAfter,
        kernelLogError: kernelLog.ok ? null : kernelLog.error,
        kills,
      },
      load: loadFigures(options.mockMetricsUrl, hogsBefore, hogsAfter),
      logs,
    };
    return judgeBurst(observation);
  } finally {
    await agent.close();
  }
}
