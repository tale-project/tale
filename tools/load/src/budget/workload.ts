/**
 * The memory budget's reference workload (tale#4942, decision of
 * 2026-11-14): finding 1's, plus a spreadsheet and a PDF indexed at the same
 * time, one transcription and ten sign-ins. Finding 1's is six people using
 * the app in a browser at once, four chat turns each; one chat turn that
 * runs `run_code` in a light sandbox; and one task the standard agent works
 * on pi until it settles.
 *
 * Every person is a browser of their own: their own connections to the
 * deployment, HTTP/2 where its edge offers it, and a browser's headers on
 * every request and event stream, `Accept-Encoding` among them, so the
 * deployment answers as it answers a browser (`createBrowserAgent`,
 * `BROWSER_HEADERS`).
 *
 * It runs in two steps, so that the setup a person does once is not read
 * as the workload:
 *
 * - `prepareWorkload`, before the sampler starts: the owner pins the
 *   standard agent to pi and to the plan's model and makes it the project's
 *   agent; the seven people who chat sign in; the reference files are made.
 * - `runWorkload`, while it samples: every part starts at the same moment.
 *   The six people open the app as a browser does (the start page and the
 *   files it loads, the dashboard's reads, their organization's dashboard
 *   and its reads, the app's event stream, Home's reads: `api/page.ts`,
 *   `api/dashboard.ts`), start a conversation and send four turns each,
 *   reading each reply before the next; the seventh opens the app the same
 *   way and asks for a chart, which the mock answers with a `run_code` call;
 *   the owner hands a task to the standard agent, uploads the spreadsheet
 *   and the PDF together and a recording beside them. Once both documents
 *   are handed over for indexing, ten more people sign in at once. The
 *   workload ends when every part has ended or its deadline passed.
 *
 * Every part counts what it was meant to do and what it did, and says what
 * went wrong: a page or a read of the app that failed, an event stream the
 * deployment refused, a standard-agent run on another runtime or engine
 * than pi as a harness run. A part that did less, or took another path,
 * did not put the weight the decision names on the deployment, so the
 * verdict fails the run (`judgeBudget`). The HTTP errors of the whole run
 * are counted beside the parts.
 */

import type { Dispatcher } from 'undici/index.js';

import { createThread, listMessages, sendMessage } from '../api/chat.ts';
import { ApiClient, asRecord, asString, orgQuery } from '../api/client.ts';
import {
  dashboardBootReads,
  homeBootReads,
  organizationBootReads,
} from '../api/dashboard.ts';
import {
  TRANSCRIPTION_TERMINAL_STATUSES,
  fileStatuses,
  registerFile,
} from '../api/files.ts';
import {
  RAG_TERMINAL_STATUSES,
  createDocumentFromUpload,
  listDocumentStatuses,
  presignUpload,
  putPresigned,
} from '../api/knowledge.ts';
import { visitPage } from '../api/page.ts';
import { openOrgEvents, openThreadStream } from '../api/realtime.ts';
import type { StreamTarget } from '../api/realtime.ts';
import { createTask } from '../api/tasks.ts';
import {
  type TaskTrack,
  isTerminal,
  listRuns,
  newestRun,
  observeTask,
  retryPending,
} from '../burst/runs.ts';
import {
  BROWSER_HEADERS,
  UserSession,
  createBrowserAgent,
} from '../client/index.ts';
import type { EventStreamHandle } from '../client/index.ts';
import { chatPrompt, threadTitle } from '../data/chat.ts';
import { UserFaker, drawLocale } from '../data/faker.ts';
import { intBetween } from '../data/random.ts';
import type { ReferenceFile } from '../data/reference-files.ts';
import { MetricsRegistry } from '../metrics/index.ts';
import type { MetricsSnapshot } from '../metrics/index.ts';
import type { LoadPlan, PlanOrganization } from '../plan.ts';
import { organizationIndexFor, userEmail } from '../plan.ts';
import { mulberry32, userSeed } from '../runner/assign.ts';

/** The workload's shape, as the decision states it. */
const REFERENCE_WORKLOAD = {
  chatUsers: 6,
  turnsPerUser: 4,
  runCodeTurns: 1,
  agentTasks: 1,
  documents: 2,
  transcriptions: 1,
  signIns: 10,
} as const;

/** People the workload needs in one organization: the owner, the six who
 * chat, the one who asks for a chart and the ten who sign in. */
export const WORKLOAD_USERS =
  1 +
  REFERENCE_WORKLOAD.chatUsers +
  REFERENCE_WORKLOAD.runCodeTurns +
  REFERENCE_WORKLOAD.signIns;

/** The runtime the standard agent is pinned to. */
export const DEFAULT_HARNESS = 'pi';

/** The engine a run of a runtime in the agent's sandbox carries, as the run
 * list names it; `native` is the engine a chat reply runs on. */
const HARNESS_ENGINE = 'harness';

/** What the person asking for a chart types; the directive makes the mock
 * answer with a `run_code` call (src/mock/run-code.ts). */
export const RUN_CODE_PROMPT =
  'Make a bar chart of our revenue by quarter as a PNG: Q1 120, Q2 135, Q3 128, Q4 150 (kCHF). [[mock:run-code]]';

/** The task the standard agent gets. Its turn answers in prose and ends. */
const AGENT_TASK_TITLE = 'Summarize the quarterly report';
export const AGENT_TASK_DESCRIPTION = [
  'Read the quarterly report the team shared and write a short summary of its main points for the next team meeting.',
  '',
  '[[mock:no-tool]]',
].join('\n');

const SEED = 4942;

export type PartKey =
  | 'chat'
  | 'run-code'
  | 'agent-task'
  | 'documents'
  | 'transcription'
  | 'sign-ins';

export type PartOutcome = 'completed' | 'failed' | 'timed-out';

export interface WorkloadPart {
  key: PartKey;
  label: string;
  expected: number;
  completed: number;
  /** On the sampler's clock (ms since it opened). */
  startedAtMs: number | null;
  endedAtMs: number | null;
  outcome: PartOutcome;
  /** What went wrong, one line each. A part with one did not complete. */
  details: string[];
}

/** The errors the run's requests and streams met, by route and kind. */
export interface HttpErrorCount {
  /** The request or stream, by its route (`POST /api/app/chat/threads`). */
  name: string;
  /** `http_<status>`, `net_<code>` or a stream's own (`idle_timeout`). */
  kind: string;
  count: number;
  /** The latest detail recorded with it. */
  sample: string | null;
}

export interface WorkloadFigures {
  /** On the sampler's clock. */
  startedAtMs: number;
  durationMs: number;
  timedOut: boolean;
  parts: WorkloadPart[];
  /** What the run used, one line each: the files, the agent, the timings. */
  facts: string[];
  /** The errors recorded while the workload ran, the most frequent first. */
  httpErrors: HttpErrorCount[];
}

export interface WorkloadIntervals {
  /** Between two polls of a run, a document or a recording. */
  pollMs: number;
  /** Before a person's first turn: a uniform draw in this range. */
  firstTurnMs: readonly [number, number];
  /** Between a reply and the next turn (reading it, typing). */
  betweenTurnsMs: readonly [number, number];
  /** A chat turn's send is held open for at most this long. */
  turnTimeoutMs: number;
  /** A presigned PUT of a reference file. */
  uploadTimeoutMs: number;
  /** A sign-in refused for load (429, 503) is asked again at most this
   * often. */
  signInAttempts: number;
  /** The wait before the n-th retry is n times this, or the refusal's
   * `Retry-After` when that is longer. */
  signInRetryMs: number;
}

const DEFAULT_INTERVALS: WorkloadIntervals = {
  pollMs: 2_000,
  firstTurnMs: [1_000, 4_000],
  betweenTurnsMs: [4_000, 12_000],
  turnTimeoutMs: 300_000,
  uploadTimeoutMs: 180_000,
  signInAttempts: 6,
  signInRetryMs: 2_000,
};

/** The workload could not be set up: nothing was measured. */
export class WorkloadSetupError extends Error {
  override name = 'WorkloadSetupError';
}

/** One person: their browser, their session in it, the API as they call it. */
interface Actor {
  /** The plan's user index. */
  index: number;
  session: UserSession;
  api: ApiClient;
  /** Their browser's connections to the deployment. */
  agent: Dispatcher;
  /** The app's files their browser holds, by path. */
  cache: Set<string>;
  /** Their API calls that failed while the workload ran, one line each. */
  failures: string[];
}

export interface ReferenceFiles {
  spreadsheet: ReferenceFile;
  pdf: ReferenceFile;
  recording: ReferenceFile;
}

export interface PrepareOptions {
  plan: LoadPlan;
  target: string;
  harness: string;
  files: ReferenceFiles;
  log?: (line: string) => void;
}

export interface PreparedWorkload {
  readonly plan: LoadPlan;
  readonly target: string;
  readonly org: PlanOrganization;
  readonly projectId: string;
  readonly modelId: string;
  readonly providerSlug: string;
  readonly harness: string;
  readonly agentId: string;
  readonly owner: Actor;
  readonly chatters: readonly Actor[];
  readonly charter: Actor;
  /** The plan indexes of the ten who sign in during the workload. */
  readonly signIns: readonly number[];
  readonly files: ReferenceFiles;
  readonly metrics: MetricsRegistry;
  /** Close every person's browser. */
  close(): Promise<void>;
}

/** Who plays what: the owner, then the organization's other members. */
export function castWorkload(plan: LoadPlan): {
  org: PlanOrganization;
  owner: number;
  chatters: number[];
  charter: number;
  signIns: number[];
} {
  const org = plan.organizations.list[0];
  if (org === undefined) {
    throw new WorkloadSetupError('the plan holds no organization');
  }
  const members: number[] = [];
  const first = org.index * plan.organizations.size;
  for (
    let index = first;
    index < Math.min(plan.users.count, first + plan.organizations.size);
    index += 1
  ) {
    if (
      index !== org.ownerIndex &&
      organizationIndexFor(plan, index) === org.index
    ) {
      members.push(index);
    }
  }
  const needed = WORKLOAD_USERS - 1;
  if (members.length < needed) {
    throw new WorkloadSetupError(
      `organization ${org.slug} has ${members.length + 1} members; the workload needs ${WORKLOAD_USERS} (seed --users ${WORKLOAD_USERS} --org-size ${WORKLOAD_USERS})`,
    );
  }
  const chatters = members.slice(0, REFERENCE_WORKLOAD.chatUsers);
  const charter = members[REFERENCE_WORKLOAD.chatUsers] ?? -1;
  const signIns = members.slice(
    REFERENCE_WORKLOAD.chatUsers + 1,
    REFERENCE_WORKLOAD.chatUsers + 1 + REFERENCE_WORKLOAD.signIns,
  );
  return { org, owner: org.ownerIndex, chatters, charter, signIns };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Resolves once `signal` aborts. */
function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** A refusal's words for a detail line: status and code. */
function refusal(result: { status: number; code: string | undefined }): string {
  return `HTTP ${result.status}${result.code === undefined ? '' : ` ${result.code}`}`;
}

/** A person's browser and their session in it, not signed in yet. */
function browserSession(
  plan: LoadPlan,
  target: string,
  index: number,
  metrics: MetricsRegistry,
  org?: PlanOrganization,
): { session: UserSession; agent: Dispatcher } {
  const agent = createBrowserAgent();
  const session = new UserSession({
    baseUrl: target,
    agent,
    metrics,
    email: userEmail(plan, index),
    password: plan.users.password,
    defaultHeaders: { ...BROWSER_HEADERS },
    ...(org === undefined ? {} : { orgId: org.id, orgSlug: org.slug }),
  });
  return { session, agent };
}

/** Sign in as `index` and act in the organization; throws on refusal. The
 * person's browser is in `agents` from the start, so it is closed either
 * way. */
async function signInActor(
  plan: LoadPlan,
  target: string,
  org: PlanOrganization,
  index: number,
  metrics: MetricsRegistry,
  agents: Dispatcher[],
): Promise<Actor> {
  const { session, agent } = browserSession(plan, target, index, metrics, org);
  agents.push(agent);
  let signedIn = await session.signIn();
  // The sign-in door counts 30 attempts a minute per address, and every
  // person here comes from one: a refusal for load is asked again after its
  // `Retry-After`.
  for (let attempt = 1; !signedIn.ok && attempt < 4; attempt += 1) {
    if (signedIn.status !== 429 && signedIn.status !== 503) break;
    await sleep(Math.max(2_000 * attempt, signedIn.retryAfterMs ?? 0));
    signedIn = await session.signIn();
  }
  if (!signedIn.ok) {
    throw new WorkloadSetupError(
      `signing in as ${userEmail(plan, index)} failed: HTTP ${signedIn.status}`,
    );
  }
  const active = await session.setActiveOrganization(org.id);
  if (!active.ok) {
    throw new WorkloadSetupError(
      `making ${org.slug} the active organization of ${userEmail(plan, index)} failed: HTTP ${active.status}`,
    );
  }
  return {
    index,
    session,
    api: new ApiClient({ requester: session }),
    agent,
    cache: new Set(),
    failures: [],
  };
}

/** Pin the standard agent to `harness` and the plan's model. */
async function pinStandardAgent(
  api: ApiClient,
  orgId: string,
  harness: string,
  providerSlug: string,
  modelId: string,
): Promise<void> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: '/api/app/governance/policies/standard_agent',
    query: orgQuery(orgId),
    json: { config: { enabled: true, harness, providerSlug, modelId } },
    name: 'POST /api/app/governance/policies/:key',
    refusals: [400, 403, 409, 422],
  });
  if (!result.ok) {
    throw new WorkloadSetupError(
      `pinning the standard agent to ${harness} failed: ${refusal(result)}`,
    );
  }
}

/** The project's standard agent, made if the project has none yet. */
async function ensureStandardAgent(
  api: ApiClient,
  orgId: string,
  projectId: string,
): Promise<string> {
  const result = await api.call<unknown>({
    method: 'POST',
    path: `/api/app/projects/${encodeURIComponent(projectId)}/standard-agent`,
    query: orgQuery(orgId),
    json: {},
    name: 'POST /api/app/projects/:id/standard-agent',
    refusals: [403, 409],
  });
  const agentId = asString(asRecord(result.body)?.agentId);
  if (!result.ok || agentId === undefined) {
    throw new WorkloadSetupError(
      result.code === 'STANDARD_AGENT_NOT_NEEDED'
        ? 'the project has agents of its own, so its standard agent cannot take the task: seed a fresh deployment'
        : `the project's standard agent is not available: ${refusal(result)}`,
    );
  }
  return agentId;
}

async function closeAll(agents: readonly Dispatcher[]): Promise<void> {
  const closed = await Promise.allSettled(agents.map((agent) => agent.close()));
  for (const outcome of closed) {
    if (outcome.status === 'rejected') {
      console.warn(
        `[budget] closing a person's connections failed: ${errorText(outcome.reason)}`,
      );
    }
  }
}

/** Set up what a person does once, before the sampler starts. */
export async function prepareWorkload(
  options: PrepareOptions,
): Promise<PreparedWorkload> {
  const log = options.log ?? ((line: string) => console.log(line));
  const cast = castWorkload(options.plan);
  const { org } = cast;
  if (
    org.projectId === null ||
    org.modelId === null ||
    org.providerSlug === null
  ) {
    throw new WorkloadSetupError(
      `organization ${org.slug} has no ${org.projectId === null ? 'project' : 'model'}: seed it with the mock provider`,
    );
  }
  const projectId = org.projectId;
  const modelId = org.modelId;
  const providerSlug = org.providerSlug;
  const metrics = new MetricsRegistry({ retentionMs: 60_000 });
  const agents: Dispatcher[] = [];
  try {
    const sign = (index: number): Promise<Actor> =>
      signInActor(options.plan, options.target, org, index, metrics, agents);
    const owner = await sign(cast.owner);
    await pinStandardAgent(
      owner.api,
      org.id,
      options.harness,
      providerSlug,
      modelId,
    );
    const agentId = await ensureStandardAgent(owner.api, org.id, projectId);
    log(
      `[budget] the standard agent ${agentId} runs ${options.harness} with ${providerSlug}/${modelId}`,
    );
    const chatters: Actor[] = [];
    for (const index of cast.chatters) chatters.push(await sign(index));
    const charter = await sign(cast.charter);
    log(
      `[budget] ${chatters.length + 2} people signed in; ${cast.signIns.length} more sign in during the workload`,
    );
    return {
      plan: options.plan,
      target: options.target,
      org,
      projectId,
      modelId,
      providerSlug,
      harness: options.harness,
      agentId,
      owner,
      chatters,
      charter,
      signIns: cast.signIns,
      files: options.files,
      metrics,
      close: () => closeAll(agents),
    };
  } catch (error) {
    await closeAll(agents);
    throw error;
  }
}

function newPart(key: PartKey, label: string, expected: number): WorkloadPart {
  return {
    key,
    label,
    expected,
    completed: 0,
    startedAtMs: null,
    endedAtMs: null,
    outcome: 'failed',
    details: [],
  };
}

interface RunContext {
  prepared: PreparedWorkload;
  intervals: WorkloadIntervals;
  clock: () => number;
  signal: AbortSignal;
  /** The people, their requests abandoned once the deadline passes. */
  owner: Actor;
  chatters: readonly Actor[];
  charter: Actor;
  streams: EventStreamHandle[];
  facts: string[];
  /** What the people's browsers fetched to open the app. */
  pages: { people: number; requests: number; chars: number };
  /** Whether the deadline had passed when each part ended. */
  endedLate: Map<WorkloadPart, boolean>;
  /** A unique prefix for this run's file names. */
  stamp: string;
}

function streamTarget(ctx: RunContext, actor: Actor): StreamTarget {
  return {
    agent: actor.agent,
    baseUrl: ctx.prepared.target,
    metrics: ctx.prepared.metrics,
    headers: () => actor.session.streamHeaders(),
  };
}

/**
 * Hold `stream` for `part` until the workload closes it: a stream that ends
 * for good before (the deployment refused it, 401, 403 or 404, or sent it a
 * stop event) is a line of the part's, and the part did not complete.
 */
function holdStream(
  ctx: RunContext,
  part: WorkloadPart,
  what: string,
  stream: EventStreamHandle,
): EventStreamHandle {
  ctx.streams.push(stream);
  void noteStreamEnd(part, what, stream);
  return stream;
}

/** Once `stream` stopped for good: a line of `part`'s unless it was closed. */
async function noteStreamEnd(
  part: WorkloadPart,
  what: string,
  stream: EventStreamHandle,
): Promise<void> {
  const reason = await stream.done;
  if (reason !== 'closed') {
    part.details.push(`${what} ended for good: ${reason}`);
  }
}

/** Run `body` as `part`: its start and end on the clock, never a throw. */
async function asPart(
  ctx: RunContext,
  part: WorkloadPart,
  body: () => Promise<void>,
): Promise<void> {
  part.startedAtMs = ctx.clock();
  try {
    await body();
  } catch (error) {
    part.details.push(`stopped by an error: ${errorText(error)}`);
    console.error(`[budget] ${part.label} stopped by an error:`, error);
  } finally {
    part.endedAtMs = ctx.clock();
    ctx.endedLate.set(part, ctx.signal.aborted);
  }
}

/**
 * One person opens the app in their browser: the start page and the files
 * it loads, the dashboard's reads, their organization's dashboard and its
 * reads, the app's event stream (held until the workload ends), and Home's
 * reads. What failed is a line of `part`'s.
 */
async function openTheApp(
  ctx: RunContext,
  actor: Actor,
  part: WorkloadPart,
  who: string,
): Promise<void> {
  const orgId = ctx.prepared.org.id;
  const failedBefore = actor.failures.length;
  const page = (path: string, name: string) =>
    visitPage(actor.session, path, {
      baseUrl: ctx.prepared.target,
      cache: actor.cache,
      name,
    });
  const start = await page('/', 'GET /');
  await dashboardBootReads(actor.api);
  const dashboard = await page(
    `/dashboard/${encodeURIComponent(orgId)}`,
    'GET /dashboard/:id',
  );
  await organizationBootReads(actor.api, orgId);
  holdStream(
    ctx,
    part,
    `${who}: the app's event stream`,
    openOrgEvents(streamTarget(ctx, actor), orgId, { onHint: () => {} }),
  );
  await homeBootReads(actor.api, orgId, actor.session.userId);
  ctx.pages.people += 1;
  ctx.pages.requests += start.requests + dashboard.requests;
  ctx.pages.chars += start.chars + dashboard.chars;
  for (const failure of [
    ...start.failures,
    ...dashboard.failures,
    ...actor.failures.slice(failedBefore),
  ]) {
    part.details.push(`${who}: opening the app: ${failure}`);
  }
}

/** One person: the app open, a conversation of four turns. */
async function runChatPerson(
  ctx: RunContext,
  actor: Actor,
  number: number,
  part: WorkloadPart,
  turnDurations: number[],
): Promise<void> {
  const { prepared, intervals, signal } = ctx;
  const orgId = prepared.org.id;
  const random = mulberry32(userSeed(SEED, actor.index));
  const data = new UserFaker(random, drawLocale(random));
  await openTheApp(ctx, actor, part, `person ${number}`);
  const thread = await createThread(actor.api, orgId, {
    title: threadTitle(data, random),
  });
  if (thread.body === undefined) {
    part.details.push(
      `person ${number}: starting a conversation failed: ${refusal(thread)}`,
    );
    return;
  }
  let reply = '';
  const lane = holdStream(
    ctx,
    part,
    `person ${number}: the conversation's stream`,
    openThreadStream(streamTarget(ctx, actor), orgId, thread.body, (event) => {
      if (event.kind === 'progress' && event.text !== '') reply = event.text;
    }),
  );
  for (let turn = 0; turn < REFERENCE_WORKLOAD.turnsPerUser; turn += 1) {
    const [low, high] =
      turn === 0 ? intervals.firstTurnMs : intervals.betweenTurnsMs;
    await sleep(intBetween(random, low, high), signal);
    if (signal.aborted) return;
    const prompt = chatPrompt(data, random, reply === '' ? undefined : reply);
    const began = performance.now();
    const sent = await sendMessage(
      actor.api,
      orgId,
      thread.body,
      {
        text: prompt.text,
        modelId: prepared.modelId,
        providerSlug: prepared.providerSlug,
      },
      intervals.turnTimeoutMs,
    );
    if (sent.body?.status === 'completed') {
      part.completed += 1;
      turnDurations.push(performance.now() - began);
      continue;
    }
    part.details.push(
      `person ${number}, turn ${turn + 1}: ${
        sent.body?.status === 'refused'
          ? `refused (${sent.body.code ?? sent.body.reason ?? 'no reason'})`
          : sent.aborted
            ? 'cut off at the deadline'
            : refusal(sent)
      }`,
    );
  }
  lane.close();
}

/** The tool result a `run_code` call left on the conversation, if any. */
export function runCodeResult(
  messages: readonly {
    role: string;
    parts: readonly Record<string, unknown>[];
  }[],
): { status: string; message: string | undefined } | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool-result' || part.capabilityId !== 'run_code')
        continue;
      const output = asRecord(part.output);
      return {
        status: asString(output?.status) ?? 'unknown',
        message: asString(output?.message),
      };
    }
  }
  return null;
}

/** The chart: one turn that runs `run_code` in a light sandbox. */
async function runChartTurn(
  ctx: RunContext,
  part: WorkloadPart,
): Promise<void> {
  const { prepared, intervals } = ctx;
  const actor = ctx.charter;
  const orgId = prepared.org.id;
  await openTheApp(ctx, actor, part, 'the person asking for a chart');
  const thread = await createThread(actor.api, orgId, {
    title: 'Revenue by quarter',
  });
  if (thread.body === undefined) {
    part.details.push(`starting the conversation failed: ${refusal(thread)}`);
    return;
  }
  const lane = holdStream(
    ctx,
    part,
    "the chart's conversation stream",
    openThreadStream(streamTarget(ctx, actor), orgId, thread.body, () => {}),
  );
  const sent = await sendMessage(
    actor.api,
    orgId,
    thread.body,
    {
      text: RUN_CODE_PROMPT,
      modelId: prepared.modelId,
      providerSlug: prepared.providerSlug,
    },
    intervals.turnTimeoutMs,
  );
  lane.close();
  if (sent.body?.status !== 'completed') {
    part.details.push(
      `the turn did not complete: ${sent.body?.status === 'refused' ? `refused (${sent.body.code ?? sent.body.reason ?? 'no reason'})` : refusal(sent)}`,
    );
    return;
  }
  const transcript = await listMessages(actor.api, orgId, thread.body);
  const result = runCodeResult(transcript.body ?? []);
  if (result === null) {
    part.details.push(
      'the turn ran no run_code: the light sandbox is not offered to this chat, or the mock did not call it',
    );
    return;
  }
  if (result.status !== 'ok') {
    part.details.push(
      `run_code answered ${result.status}: ${result.message ?? 'no message'}`,
    );
    return;
  }
  part.completed = 1;
}

/** The task the standard agent works on pi, followed until it settles. */
async function runAgentTask(
  ctx: RunContext,
  part: WorkloadPart,
): Promise<void> {
  const { prepared, intervals, signal } = ctx;
  const orgId = prepared.org.id;
  const created = await createTask(ctx.owner.api, orgId, {
    projectId: prepared.projectId,
    title: AGENT_TASK_TITLE,
    description: AGENT_TASK_DESCRIPTION,
    status: 'in_progress',
    assigneeType: 'agent',
    assigneeId: prepared.agentId,
  });
  if (created.body === undefined) {
    part.details.push(
      `handing the task to the standard agent failed: ${refusal(created)}`,
    );
    return;
  }
  const track: TaskTrack = {
    taskId: created.body,
    title: AGENT_TASK_TITLE,
    agentIndex: 0,
    createdAtMs: Date.now(),
    runs: [],
    doneAtMs: null,
    longestWithoutRunMs: 0,
  };
  while (!signal.aborted) {
    await sleep(intervals.pollMs, signal);
    if (signal.aborted) break;
    const rows = await listRuns(ctx.owner.api, orgId, track.taskId);
    if (rows === null) continue;
    observeTask(track, rows, Date.now());
    const newest = newestRun(track);
    if (newest === null || !isTerminal(newest.place)) continue;
    if (
      newest.place === 'failed' &&
      (await retryPending(ctx.owner.api, orgId, track.taskId)) !== false
    ) {
      continue;
    }
    if (newest.place !== 'settled') {
      part.details.push(
        `the run ended ${newest.place}${newest.failureCode === null ? '' : ` (${newest.failureCode})`}${newest.error === null ? '' : `: ${newest.error}`}`,
      );
    } else if (
      newest.harness !== prepared.harness ||
      newest.engine !== HARNESS_ENGINE
    ) {
      // A run that settled on another runtime, or on the engine a chat reply
      // runs on, did not put a pi session's weight on the deployment.
      part.details.push(
        `the run settled on ${newest.harness ?? 'no named runtime'} with the ${newest.engine ?? 'unnamed'} engine, not on ${prepared.harness} with the ${HARNESS_ENGINE} engine`,
      );
    } else {
      part.completed = 1;
    }
    ctx.facts.push(
      `The standard agent's task: ${track.runs.length} run${track.runs.length === 1 ? '' : 's'}, the last ${newest.place} on ${newest.harness ?? 'no named runtime'} (${newest.engine ?? 'unnamed'} engine) ${((Date.now() - track.createdAtMs) / 1000).toFixed(0)} s after the task was handed over`,
    );
    return;
  }
  const newest = newestRun(track);
  part.details.push(
    `the run was still ${newest === null ? 'not started' : newest.place} at the deadline`,
  );
}

/** Upload one file the way the app does: presign, PUT, then bind. */
async function upload(
  ctx: RunContext,
  file: ReferenceFile,
): Promise<{ storageRef: string } | { error: string }> {
  const { prepared, intervals } = ctx;
  const api = ctx.owner.api;
  const orgId = prepared.org.id;
  const ticket = await presignUpload(api, orgId, file.contentType);
  if (ticket.body === undefined) {
    return { error: `presigning ${file.fileName} failed: ${refusal(ticket)}` };
  }
  const status = await putPresigned(
    ctx.owner.agent,
    prepared.metrics,
    ticket.body.url,
    file.contentType,
    file.bytes,
    intervals.uploadTimeoutMs,
    BROWSER_HEADERS,
  );
  if (status < 200 || status >= 300) {
    return {
      error: `the object store took ${file.fileName} with HTTP ${status}`,
    };
  }
  return { storageRef: ticket.body.storageRef };
}

/** The spreadsheet and the PDF, uploaded together, followed until indexed. */
async function runDocuments(
  ctx: RunContext,
  part: WorkloadPart,
  bound: () => void,
): Promise<void> {
  const { prepared, intervals, signal } = ctx;
  const api = ctx.owner.api;
  const orgId = prepared.org.id;
  const files = [prepared.files.spreadsheet, prepared.files.pdf];
  const ids = new Map<string, ReferenceFile>();
  try {
    await Promise.all(
      files.map(async (file) => {
        const landed = await upload(ctx, file);
        if ('error' in landed) {
          part.details.push(landed.error);
          return;
        }
        const document = await createDocumentFromUpload(api, orgId, {
          storageRef: landed.storageRef,
          fileName: `${ctx.stamp}-${file.fileName}`,
          contentType: file.contentType,
        });
        if (document.body === undefined) {
          part.details.push(
            `adding ${file.fileName} to the documents failed: ${refusal(document)}`,
          );
          return;
        }
        ids.set(document.body, file);
      }),
    );
  } finally {
    bound();
  }
  const pending = new Set(ids.keys());
  while (pending.size > 0 && !signal.aborted) {
    await sleep(intervals.pollMs, signal);
    if (signal.aborted) break;
    const listed = await listDocumentStatuses(api, orgId);
    for (const row of listed.body ?? []) {
      if (!pending.has(row.id)) continue;
      const status = row.ragStatus;
      if (status === undefined || !RAG_TERMINAL_STATUSES.has(status)) continue;
      pending.delete(row.id);
      const file = ids.get(row.id);
      if (status === 'completed') {
        part.completed += 1;
        ctx.facts.push(
          `${file?.fileName ?? row.id} indexed by +${(ctx.clock() / 1000).toFixed(1)} s`,
        );
      } else {
        part.details.push(
          `${file?.fileName ?? row.id} ended ${status}${row.ragError === undefined ? '' : `: ${row.ragError}`}`,
        );
      }
    }
  }
  for (const id of pending) {
    part.details.push(
      `${ids.get(id)?.fileName ?? id} was still being indexed at the deadline`,
    );
  }
}

/** One recording, uploaded as the composer does and transcribed. */
async function runTranscription(
  ctx: RunContext,
  part: WorkloadPart,
): Promise<void> {
  const { prepared, intervals, signal } = ctx;
  const api = ctx.owner.api;
  const orgId = prepared.org.id;
  const file = prepared.files.recording;
  const landed = await upload(ctx, file);
  if ('error' in landed) {
    part.details.push(landed.error);
    return;
  }
  const registered = await registerFile(api, orgId, {
    storageRef: landed.storageRef,
    fileName: `${ctx.stamp}-${file.fileName}`,
    contentType: file.contentType,
  });
  if (!registered.ok) {
    part.details.push(
      `registering the recording failed: ${refusal(registered)}`,
    );
    return;
  }
  let last: string | undefined;
  while (!signal.aborted) {
    await sleep(intervals.pollMs, signal);
    if (signal.aborted) break;
    const statuses = await fileStatuses(api, orgId, [landed.storageRef]);
    const row = statuses.body?.find(
      (status) => status.storageRef === landed.storageRef,
    );
    last = row?.transcriptionStatus;
    if (last === undefined || !TRANSCRIPTION_TERMINAL_STATUSES.has(last))
      continue;
    if (last === 'completed') {
      part.completed = 1;
      ctx.facts.push(
        `${file.fileName} transcribed by +${(ctx.clock() / 1000).toFixed(1)} s`,
      );
    } else {
      part.details.push(
        `the transcription ended ${last}${row?.transcriptionError === undefined ? '' : `: ${row.transcriptionError}`}`,
      );
    }
    return;
  }
  part.details.push(
    `the transcription was still ${last ?? 'not started'} at the deadline`,
  );
}

/** Ten people sign in at once, each from a browser of their own; a refusal
 * for load is asked again after its `Retry-After`, as a person tries again. */
async function runSignIns(
  ctx: RunContext,
  part: WorkloadPart,
  documentsBound: Promise<void>,
): Promise<void> {
  const { prepared, intervals, signal } = ctx;
  await Promise.race([documentsBound, untilAborted(signal)]);
  if (signal.aborted) return;
  part.startedAtMs = ctx.clock();
  const began = performance.now();
  let refusals = 0;
  let slowest = 0;
  const agents: Dispatcher[] = [];
  try {
    await Promise.all(
      prepared.signIns.map(async (index) => {
        const { session, agent } = browserSession(
          prepared.plan,
          prepared.target,
          index,
          prepared.metrics,
        );
        agents.push(agent);
        for (
          let attempt = 1;
          attempt <= intervals.signInAttempts;
          attempt += 1
        ) {
          const result = await session.signIn();
          if (result.ok) {
            part.completed += 1;
            slowest = Math.max(slowest, performance.now() - began);
            return;
          }
          if (
            (result.status !== 429 && result.status !== 503) ||
            signal.aborted
          ) {
            part.details.push(`${session.email}: HTTP ${result.status}`);
            return;
          }
          refusals += 1;
          await sleep(
            Math.max(
              intervals.signInRetryMs * attempt,
              result.retryAfterMs ?? 0,
            ),
            signal,
          );
        }
        part.details.push(
          `${session.email}: refused ${intervals.signInAttempts} times for load`,
        );
      }),
    );
  } finally {
    await closeAll(agents);
  }
  ctx.facts.push(
    `${part.completed} sign-ins at +${((part.startedAtMs ?? 0) / 1000).toFixed(1)} s, the last answered ${(slowest / 1000).toFixed(1)} s later${refusals === 0 ? '' : `, after ${refusals} refusal${refusals === 1 ? '' : 's'} for load`}`,
  );
}

/** The errors recorded between two snapshots of the run's metrics, the
 * most frequent first. */
export function httpErrorsBetween(
  before: MetricsSnapshot['errors'],
  after: MetricsSnapshot['errors'],
): HttpErrorCount[] {
  const rows: HttpErrorCount[] = [];
  for (const [name, kinds] of Object.entries(after)) {
    for (const [kind, entry] of Object.entries(kinds)) {
      const count = entry.count - (before[name]?.[kind]?.count ?? 0);
      if (count <= 0) continue;
      rows.push({ name, kind, count, sample: entry.samples.at(-1) ?? null });
    }
  }
  return rows.sort(
    (a, b) =>
      b.count - a.count ||
      a.name.localeCompare(b.name) ||
      a.kind.localeCompare(b.kind),
  );
}

export interface RunOptions {
  /** The sampler's clock, so the parts line up with the readings. */
  clock: () => number;
  deadlineMs: number;
  intervals?: Partial<WorkloadIntervals>;
  /** Progress lines every 15 s; `reading` names the deployment's figure. */
  log?: (line: string) => void;
  reading?: () => string;
}

/** Run every part at once until each has ended or the deadline passed. */
export async function runWorkload(
  prepared: PreparedWorkload,
  options: RunOptions,
): Promise<WorkloadFigures> {
  const log = options.log ?? ((line: string) => console.log(line));
  const intervals = { ...DEFAULT_INTERVALS, ...options.intervals };
  const controller = new AbortController();
  // Each person's requests are abandoned once the deadline passes, a chat
  // turn's held send included; the calls that fail are kept as theirs.
  const withDeadline = (actor: Actor): Actor => {
    const failures: string[] = [];
    return {
      index: actor.index,
      session: actor.session,
      agent: actor.agent,
      cache: actor.cache,
      failures,
      api: new ApiClient({
        requester: actor.session,
        signal: controller.signal,
        observer: {
          onResponse: (name, response) => {
            if (!response.ok) {
              failures.push(
                `${name}: ${response.errorKind ?? `HTTP ${response.status}`}`,
              );
            }
          },
        },
      }),
    };
  };
  const ctx: RunContext = {
    prepared,
    intervals,
    clock: options.clock,
    signal: controller.signal,
    owner: withDeadline(prepared.owner),
    chatters: prepared.chatters.map(withDeadline),
    charter: withDeadline(prepared.charter),
    streams: [],
    facts: [
      `${prepared.files.spreadsheet.fileName}: ${prepared.files.spreadsheet.description}`,
      `${prepared.files.pdf.fileName}: ${prepared.files.pdf.description}`,
      `${prepared.files.recording.fileName}: ${prepared.files.recording.description}`,
      `The standard agent runs ${prepared.harness} with ${prepared.providerSlug}/${prepared.modelId}`,
    ],
    pages: { people: 0, requests: 0, chars: 0 },
    endedLate: new Map(),
    stamp: `budget-${Date.now().toString(36)}`,
  };
  const chat = newPart(
    'chat',
    `${REFERENCE_WORKLOAD.chatUsers} people × ${REFERENCE_WORKLOAD.turnsPerUser} chat turns`,
    REFERENCE_WORKLOAD.chatUsers * REFERENCE_WORKLOAD.turnsPerUser,
  );
  const runCode = newPart('run-code', 'a chat turn that runs run_code', 1);
  const task = newPart(
    'agent-task',
    `a standard-agent task on ${prepared.harness}`,
    1,
  );
  const docs = newPart(
    'documents',
    'a spreadsheet and a PDF indexed at once',
    2,
  );
  const recording = newPart('transcription', 'one transcription', 1);
  const logins = newPart(
    'sign-ins',
    `${REFERENCE_WORKLOAD.signIns} sign-ins`,
    prepared.signIns.length,
  );
  const parts = [chat, runCode, task, docs, recording, logins];

  const errorsBefore = prepared.metrics.snapshot().errors;
  const startedAtMs = options.clock();
  const deadline = setTimeout(() => controller.abort(), options.deadlineMs);
  const progress = setInterval(() => {
    const done = parts
      .map((part) => `${part.key} ${part.completed}/${part.expected}`)
      .join(', ');
    log(
      `[budget] +${((options.clock() - startedAtMs) / 1000).toFixed(0)} s: ${done}${options.reading === undefined ? '' : `; ${options.reading()}`}`,
    );
  }, 15_000);
  let bound: () => void = () => {};
  const documentsBound = new Promise<void>((resolve) => {
    bound = resolve;
  });
  const turnDurations: number[] = [];
  try {
    await Promise.all([
      asPart(ctx, chat, async () => {
        await Promise.all(
          ctx.chatters.map((actor, index) =>
            runChatPerson(ctx, actor, index + 1, chat, turnDurations),
          ),
        );
      }),
      asPart(ctx, runCode, () => runChartTurn(ctx, runCode)),
      asPart(ctx, task, () => runAgentTask(ctx, task)),
      asPart(ctx, docs, () => runDocuments(ctx, docs, bound)),
      asPart(ctx, recording, () => runTranscription(ctx, recording)),
      asPart(ctx, logins, () => runSignIns(ctx, logins, documentsBound)),
    ]);
  } finally {
    clearTimeout(deadline);
    clearInterval(progress);
    for (const stream of ctx.streams) stream.close();
    // A stream's end is a line of its part's: every one is in before the
    // parts are judged.
    await Promise.all(ctx.streams.map((stream) => stream.done));
  }
  for (const part of parts) {
    part.outcome =
      part.completed >= part.expected && part.details.length === 0
        ? 'completed'
        : ctx.endedLate.get(part) === true
          ? 'timed-out'
          : 'failed';
  }
  if (ctx.pages.people > 0) {
    ctx.facts.push(
      `${ctx.pages.people} people opened the app: ${ctx.pages.requests} pages and files, ${(ctx.pages.chars / 1e6).toFixed(1)} M characters decoded`,
    );
  }
  if (turnDurations.length > 0) {
    const mean =
      turnDurations.reduce((sum, ms) => sum + ms, 0) / turnDurations.length;
    ctx.facts.push(
      `Chat turns: ${turnDurations.length} completed, ${(mean / 1000).toFixed(1)} s from send to settle on average`,
    );
  }
  return {
    startedAtMs,
    durationMs: options.clock() - startedAtMs,
    timedOut: controller.signal.aborted,
    parts,
    facts: ctx.facts,
    httpErrors: httpErrorsBetween(
      errorsBefore,
      prepared.metrics.snapshot().errors,
    ),
  };
}
