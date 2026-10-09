'use node';

// Platform → spawner client for the persistent-session API: the HMAC signing
// contract (SANDBOX_URL / SANDBOX_TOKEN env) plus the session verbs — the
// one-shot `spawner_client.ts` it used to mirror is retired. Lives in
// node_only because it streams SSE. Every call goes through `spawnerFetch`.
//
// Signature contract (services/sandbox/src/auth.ts):
//   signedString = `${METHOD}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`
//   signature    = HMAC-SHA256(SANDBOX_TOKEN, signedString)
// The per-request nonce keeps byte-identical requests (e.g. the empty-body
// sessionIsAlive GET) from colliding in the spawner's replay cache.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createParser } from 'eventsource-parser';
import { z } from 'zod';

import {
  sandboxCapacitySchema,
  sandboxDeploymentLimitsSchema,
  type SandboxCapacityObservation,
} from '../../../../../lib/shared/schemas/sandbox-capacity.ts';
import {
  hubDevicesSchema,
  type HubDevices,
} from '../../../../../lib/shared/schemas/sandbox-devices.ts';
import { traceSandboxPhase } from '../../../../tracing';

const SIGNATURE_HEADER = 'x-tale-sandbox-signature';
const TIMESTAMP_HEADER = 'x-tale-sandbox-timestamp';
const NONCE_HEADER = 'x-tale-sandbox-nonce';

// Mirror of the spawner's auth.ts signed-string format. The per-request nonce
// makes byte-identical requests (notably the empty-body `sessionIsAlive` GET)
// sign distinct strings, so two probes in the same millisecond don't
// false-positive against the spawner's replay cache.
function signRequest(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
  token: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signedString = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  return createHmac('sha256', token).update(signedString).digest('hex');
}

/** The session is gone spawner-side (404). NOT a transient drop — the resilient
 * drain must not retry it, and the caller self-heals the stale platform row. */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

/** A workspace file larger than its reader's `maxBytes` — refused on its
 * declared length before a byte is read, or at the first chunk past the
 * cap, so the platform never holds more than the cap plus one chunk. */
export class SessionFileTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(filePath: string, maxBytes: number) {
    super(`${filePath} is larger than ${maxBytes} bytes`);
    this.name = 'SessionFileTooLargeError';
    this.maxBytes = maxBytes;
  }
}

/** The spawner answered an attach with its "exec <id> not found" error
 * event: the session is alive but knows no such exec. Distinguished so the
 * resilient drain can tell "the exec was never created" (re-POST it) from a
 * transient stream drop (re-attach). */
class ExecNotFoundError extends Error {
  constructor(execId: string) {
    super(`sandbox session exec ${execId} not found on the spawner`);
    this.name = 'ExecNotFoundError';
  }
}

/** Spawner already owns this session or is creating it (HTTP 409). A caller
 * adopting the existing runtime must acquire it before starting work while
 * preserving the standing workspace. */
export class SessionDuplicateError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} already exists spawner-side`);
    this.name = 'SessionDuplicateError';
  }
}

/** Where a refused create stands in the spawner's first-come line for host
 * room: its place, and how many creates wait in the line. */
export interface SpawnerQueuePlace {
  position: number;
  waiting: number;
}

/** The spawner is at its global host capacity (HTTP 429: `session_quota`,
 * `host_memory` when the host is short of memory, `host_cpu` while its CPU
 * is under pressure and sessions start one at a time, or `host_disk` when the
 * disk the workspaces live on is short of space), or a destroy of the id
 * is still under way. Distinct from the platform's per-workload
 * `QUOTA_EXCEEDED`: the host is shared across organizations. The retry hint
 * lets each workload apply its own wait; an earlier capacity read reserves
 * no compute. A spawner that keeps a first-come line for host room says
 * where the create stands in it (`queue`), and its hint is then the moment
 * that place comes up: a waiter that asks later loses its turn to the ones
 * behind it, so it comes back exactly then. */
export class SpawnerBusyError extends Error {
  readonly retryAfterMs: number | undefined;
  readonly queue: SpawnerQueuePlace | undefined;
  constructor(retryAfterMs: number | undefined, queue?: SpawnerQueuePlace) {
    super('sandbox spawner at host capacity (429)');
    this.name = 'SpawnerBusyError';
    this.retryAfterMs = retryAfterMs;
    this.queue = queue;
  }
}

/** The `errorCode` of an exec result whose exec the session's runtime refused
 * before it spawned, because the session already runs its maximum of live
 * execs (runnerd's `EXEC_LIMIT`, forwarded as is by the spawner:
 * `services/sandbox/src/wire.ts`). */
const SESSION_EXEC_LIMIT_CODE = 'EXEC_LIMIT';

/** Whether an exec's result is the session runtime's refusal for want of a
 * live-exec place ({@link SESSION_EXEC_LIMIT_CODE}): the process never ran. */
export function isSessionExecLimitResult(
  result: SessionExecResult | undefined,
): boolean {
  return (
    result?.status === 'failed' &&
    result.exitCode === null &&
    result.errorCode === SESSION_EXEC_LIMIT_CODE
  );
}

/** A start whose exec the session's runtime refused because every one of its
 * live-exec places is taken by the session's other execs. Distinct from
 * {@link SpawnerBusyError}: the room that ran out is this one workspace's,
 * not the shared host's, and it frees when another exec of the session
 * ends. Nothing ran, so the start waits instead of failing. */
export class SessionExecLimitError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string, execId: string) {
    super(
      `sandbox session ${sessionId} refused exec ${execId}: every live-exec place is taken`,
    );
    this.name = 'SessionExecLimitError';
    this.sessionId = sessionId;
  }
}

/** The `queue` field of a 429 body, as a boundary: a body that is not JSON,
 * names no line or names one out of shape is an older spawner's answer, and
 * the create waits as it always did. */
const spawnerQueueBodySchema = z.object({
  queue: z.object({
    position: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
});

/** The refusal a 429 to a create is, with its place in the spawner's line
 * when the body names one. */
async function spawnerBusyErrorOf(res: Response): Promise<SpawnerBusyError> {
  const retryAfterMs = parseRetryAfterMs(res);
  const text = await safeText(res);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new SpawnerBusyError(retryAfterMs);
  }
  const parsed = spawnerQueueBodySchema.safeParse(body);
  return new SpawnerBusyError(
    retryAfterMs,
    parsed.success ? parsed.data.queue : undefined,
  );
}

/**
 * The spawner did not answer at all: DNS, connect or socket failure — no
 * status, no body. Wrapped because the bare `TypeError: fetch failed` names
 * nothing it was doing: a spawner that refuses to boot (2026-09: an unset
 * `SANDBOX_TOKEN` crash-looped it) takes every agent turn on the deployment
 * down, and the runs could only report "the agent turn could not start: fetch
 * failed". Carries WHAT was called, WHERE it was called, and the syscall the
 * runtime reported — and keeps the original as `cause`.
 */
export class SpawnerUnreachableError extends Error {
  constructor(method: string, path: string, target: string, cause: unknown) {
    const where = spawnerTargetLabel(target);
    // fetch reports the syscall on its own `cause` (getaddrinfo EAI_AGAIN,
    // ECONNREFUSED, ...) — that inner line is the whole diagnosis, so lift it
    // into the message instead of leaving it two `cause` hops deep.
    const outer = cause instanceof Error ? cause.message : String(cause);
    const inner =
      cause instanceof Error && cause.cause instanceof Error
        ? `: ${cause.cause.message}`
        : '';
    super(
      `sandbox spawner unreachable at ${where} (${method} ${path}): ${outer}${inner} — is the sandbox service running, and does SANDBOX_URL point at it?`,
      { cause },
    );
    this.name = 'SpawnerUnreachableError';
  }
}

/** The spawner URL as it may be printed. This message reaches the error
 * tracker, so credentials an operator embedded in SANDBOX_URL are dropped
 * rather than reported; an unparseable value is echoed as given (it is the
 * misconfiguration the reader needs to see). */
function spawnerTargetLabel(target: string): string {
  try {
    const parsed = new URL(target);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return target;
  }
}

/** The spawner's device hub answered for a session that lives on one of the
 * organization's connected devices, and that device is not connected. The
 * workspace is intact on the machine — NOT a "session gone" signal: callers
 * must never mark the session destroyed on it. */
export class SandboxDeviceOfflineError extends Error {
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(
      `the device this sandbox runs on (${deviceId}) is not connected — its workspace stays on that machine; the work can continue once it reconnects`,
    );
    this.name = 'SandboxDeviceOfflineError';
    this.deviceId = deviceId;
  }
}

/** Header the hub sets on every answer it gave for a device. */
const DEVICE_HEADER = 'x-tale-sandbox-device';

/** A 503 the hub answered because a session's device is offline (judged on
 * the already-read body), or null. */
function deviceOfflineIn(
  res: Response,
  body: string,
): SandboxDeviceOfflineError | null {
  const deviceId = res.headers.get(DEVICE_HEADER);
  return res.status === 503 &&
    deviceId !== null &&
    body.includes('device_offline')
    ? new SandboxDeviceOfflineError(deviceId)
    : null;
}

/** Throw the device-offline error a 503 carries; other answers pass. */
async function throwIfDeviceOffline(res: Response): Promise<void> {
  if (res.status !== 503 || res.headers.get(DEVICE_HEADER) === null) return;
  const offline = deviceOfflineIn(res, await safeText(res));
  if (offline) throw offline;
}

/** Parse an HTTP `retry-after` header (delta-seconds) into ms, if present. */
function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** How long one acquire or create keeps asking again after answers that say
 * "in a moment": a 503 `session_unavailable` (a sibling create of the id in
 * flight, a backend listing that timed out, a container still starting) and
 * a connection the spawner did not take (it is restarting). Long enough for
 * a spawner restart or a slow `docker ps`; short against the turn it delays,
 * so a spawner that stays away still fails the start. */
const SPAWNER_TRANSIENT_RETRY_BUDGET_MS = 20_000;
/** The first wait after a refused connection; it doubles per retry. */
const SPAWNER_TRANSIENT_RETRY_MIN_MS = 250;
/** The longest single wait, whatever the backoff or a `retry-after` says. */
const SPAWNER_TRANSIENT_RETRY_MAX_MS = 5_000;

/** The connection failures that say the spawner is not there right now
 * rather than that the request went wrong: refused (restarting), reset
 * (killed mid-connect) and a name lookup that timed out (its DNS entry is
 * being replaced). */
const TRANSIENT_CONNECTION_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
]);

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** Whether a call failed because the spawner did not take the connection
 * (see {@link TRANSIENT_CONNECTION_CODES}). The runtime's fetch reports the
 * syscall on the failure's `cause`, or on each of an `AggregateError`'s
 * errors when it tried several addresses. */
function isTransientConnectionFailure(error: unknown): boolean {
  if (!(error instanceof SpawnerUnreachableError)) return false;
  const fetchFailure = error.cause;
  const syscall =
    fetchFailure instanceof Error ? fetchFailure.cause : undefined;
  const codes =
    syscall instanceof AggregateError
      ? syscall.errors.map(errorCodeOf)
      : [errorCodeOf(syscall)];
  return codes.some(
    (code) => code !== undefined && TRANSIENT_CONNECTION_CODES.has(code),
  );
}

/** One call's allowance of retries of transient spawner answers: an
 * acquire's or a create's {@link SPAWNER_TRANSIENT_RETRY_BUDGET_MS}, or, for
 * an exec drain riding out a spawner outage, as long as its caller's signal
 * lets it run. */
class SpawnerRetryBudget {
  private readonly deadline: number;
  private retries = 0;

  constructor(budgetMs: number = SPAWNER_TRANSIENT_RETRY_BUDGET_MS) {
    this.deadline = Date.now() + budgetMs;
  }

  /** How long to wait before asking again — the spawner's own hint when it
   * gave one, else a doubling backoff — or undefined once that wait would
   * end past the budget. */
  nextWaitMs(hintMs: number | undefined): number | undefined {
    const backoff = SPAWNER_TRANSIENT_RETRY_MIN_MS * 2 ** this.retries;
    const waitMs = Math.min(
      SPAWNER_TRANSIENT_RETRY_MAX_MS,
      Math.max(SPAWNER_TRANSIENT_RETRY_MIN_MS, hintMs ?? backoff),
    );
    if (Date.now() + waitMs > this.deadline) return undefined;
    this.retries += 1;
    return waitMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait `ms`, or reject with the signal's reason the moment it aborts. */
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Send one acquire or create request, waiting out a refused connection
 * within the call's retry budget; any other failure, or one past the
 * budget, is thrown as it came. */
async function spawnerFetchRetryingConnection(
  budget: SpawnerRetryBudget,
  method: string,
  path: string,
  opts: () => { body?: string; signal?: AbortSignal },
): Promise<Response> {
  for (;;) {
    try {
      return await spawnerFetch(method, path, opts());
    } catch (error) {
      const waitMs = isTransientConnectionFailure(error)
        ? budget.nextWaitMs(undefined)
        : undefined;
      if (waitMs === undefined) throw error;
      console.warn(
        `[sandbox] ${method} ${path}: the spawner did not take the connection; asking again in ${waitMs} ms`,
      );
      await sleep(waitMs);
    }
  }
}

/** A spawner call answered with a status its caller has no answer of its own
 * for (a 404 is {@link SessionNotFoundError}). Keeps the status and the
 * spawner's `retry-after`, so a drain can tell "not now" from a verdict. */
export class SpawnerStatusError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(message: string, res: Response) {
    super(message);
    this.name = 'SpawnerStatusError';
    this.status = res.status;
    this.retryAfterMs = parseRetryAfterMs(res);
  }
}

/**
 * The error a refused exec, attach or checkpoint request is. A 503 the
 * device hub gave because the session's device is not connected is
 * {@link SandboxDeviceOfflineError}: the spawner did answer, and a device
 * can stay away for hours (a closed laptop), so a drain fails on it as on
 * any verdict, naming the device, instead of waiting it out as a spawner
 * outage. Only a device's 503 is read, to tell that answer from the device
 * spawner's own "not now". Anything else is a {@link SpawnerStatusError}, its
 * body released: a drain that asks again every few seconds must not hold a
 * connection per refused answer until it is collected. The release is not
 * awaited — a cancel acknowledgement can stall.
 */
async function refusedAnswerErrorOf(
  message: string,
  res: Response,
): Promise<SpawnerStatusError | SandboxDeviceOfflineError> {
  if (res.status === 503 && res.headers.get(DEVICE_HEADER) !== null) {
    return (
      deviceOfflineIn(res, await safeText(res)) ??
      new SpawnerStatusError(message, res)
    );
  }
  void res.body?.cancel().catch((error: unknown) => {
    console.warn('[session_client] releasing a refused answer failed:', error);
  });
  return new SpawnerStatusError(message, res);
}

/** The answers that say "not now" rather than anything about the exec: the
 * spawner is at capacity (429), nothing answered behind a proxy (502), it is
 * booting, adopting its sessions or could not list them in time (503
 * `session_unavailable`), or a gateway stopped waiting for it (504). A
 * device's offline answer is no such status: it arrives as
 * {@link SandboxDeviceOfflineError}. */
const SPAWNER_NOT_NOW_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503, 504,
]);

/** The exec's stream broke before it delivered the exec's result: the
 * connection dropped mid-read (the spawner restarted, the network cut it).
 * It says nothing about the exec, which runnerd keeps running; a re-attach
 * resumes after the cursor. A stream the spawner closed cleanly without a
 * result is not this: it still costs the drain one of its failures. */
class ExecStreamDroppedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExecStreamDroppedError';
  }
}

/**
 * Whether an exec drain lost the exec to the way there rather than to a
 * verdict on it. Transport: the spawner did not take or answer the request
 * ({@link SpawnerUnreachableError} — every fetch failure, the refused, reset
 * and unresolved connections a restart causes included), the stream broke
 * mid-read, the spawner answered "not now" ({@link SPAWNER_NOT_NOW_STATUSES}),
 * or a call to it timed out. Everything else is a verdict: a 404
 * ({@link SessionNotFoundError}), a device the hub reports not connected
 * ({@link SandboxDeviceOfflineError}), a replay or protocol gap, an error the
 * stream itself reported.
 *
 * Wider than the connection codes an acquire or a create waits out
 * ({@link isTransientConnectionFailure}): a drain runs against an exec the
 * same `SANDBOX_URL` already started, so a name that stops resolving while
 * the spawner's container is replaced is the spawner being away, not a
 * misconfiguration to fail fast on.
 */
export function isSpawnerTransportFailure(error: unknown): boolean {
  if (
    error instanceof SpawnerUnreachableError ||
    error instanceof ExecStreamDroppedError
  )
    return true;
  if (error instanceof SpawnerStatusError)
    return SPAWNER_NOT_NOW_STATUSES.has(error.status);
  return error instanceof Error && error.name === 'TimeoutError';
}

/** What a drain that rides out a spawner outage tells its caller about its
 * hold on the exec's stream. */
export interface ExecStreamContact {
  /** The spawner answered with the exec's stream. */
  onAttached(): void;
  /** The stream was lost to the transport; the drain attaches again. */
  onLost(error: unknown): void;
}

/** The exec SSE went silent past the idle-read deadline (no events AND no
 * keepalive — a half-open/wedged connection). The resilient drain re-attaches
 * via sinceSeq WITHOUT consuming its consecutive-failure budget: a genuinely
 * dead sandbox surfaces as a real fetch error on the re-attach (which DOES
 * count), while a merely-quiet-but-live exec resumes losslessly. Never a turn
 * failure on its own — the only bound on a quiet phase is the action window. */
class ExecStreamIdleError extends Error {
  constructor(execId: string) {
    super(`exec ${execId} stream idle past the read deadline`);
    this.name = 'ExecStreamIdleError';
  }
}

function getSpawnerUrl(): string {
  // Host bun-dev default. Container api/worker MUST set SANDBOX_URL
  // (compose / entrypoint default http://sandbox:8003) or every session call
  // goes to localhost inside the container and fails — as
  // SpawnerUnreachableError, which names this URL so the mistake is readable.
  return process.env.SANDBOX_URL ?? 'http://localhost:8003';
}

/** Result of a session create. */
export interface SessionCreateResult {
  session: SessionInfo;
}

/**
 * The shared HMAC secret every spawner call is signed with. REQUIRED — fail
 * closed: the spawner refuses to start without it and answers 401 to anything
 * unsigned (services/sandbox/src/{config,request-auth}.ts), so sending
 * unsigned requests is not a mode, it is a misconfiguration this process can
 * see in its own env. Surfaced before any network call, the same way
 * `requireGatewayAdminPassword` guards the gateway's management plane.
 *
 * Trimmed so a whitespace-only value counts as unset — must match the server's
 * trim, or a padded token would derive a different HMAC key on each side.
 */
function requireSpawnerToken(): string {
  const token = process.env.SANDBOX_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'SANDBOX_TOKEN is not set — the sandbox spawner signs every request with it and rejects ' +
        'unsigned ones. `tale deploy` and `bun run dev` mint it into .env; for a hand-rolled ' +
        'compose stack set SANDBOX_TOKEN=$(openssl rand -hex 32) there. The SAME value must reach ' +
        'the backend, the platform and the sandbox service.',
    );
  }
  return token;
}

/** Build signed headers for a request to the spawner (method + path + body). */
function signedHeaders(
  method: string,
  path: string,
  body: string,
  accept?: string,
): Record<string, string> {
  const token = requireSpawnerToken();
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [SIGNATURE_HEADER]: signRequest(
      method,
      path,
      timestamp,
      nonce,
      body,
      token,
    ),
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
  };
  if (accept) headers.accept = accept;
  return headers;
}

/**
 * The one door for every spawner call: composes the URL, signs the request,
 * and attributes a transport failure to the call that suffered it.
 *
 * ONLY a `TypeError` (what fetch throws when the request never completed) is
 * wrapped. An abort — the caller's signal, the turn-ended cut — and a timeout
 * are control flow the callers branch on (the resilient drain re-attaches on
 * them), so they pass through untouched.
 */
async function spawnerFetch(
  method: string,
  path: string,
  opts: { body?: string; accept?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const target = getSpawnerUrl();
  try {
    return await fetch(`${target}${path}`, {
      method,
      headers: signedHeaders(method, path, opts.body ?? '', opts.accept),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    throw new SpawnerUnreachableError(method, path, target, err);
  }
}

export interface SessionCreateBody {
  /** Optional capability narrowing; never overrides the deployment ceiling. */
  docker?: boolean;
  workload?: 'project' | 'workflow';
  sessionId: string;
  organizationId: string;
  profile: 'default' | 'agent' | 'agent-light';
  ttlMs?: number;
  idleTimeoutMs?: number;
  env?: Record<string, string>;
  /** `device`: may start on one of the organization's connected devices
   * (the hub picks one with room, else the server). Absent = the server. A
   * session keeps the machine it first started on either way. */
  placement?: 'device' | 'server';
}

export interface SessionInfo {
  sessionId: string;
  organizationId: string;
  profile: 'default' | 'agent' | 'agent-light';
  state: string;
  backend: string;
  createdAtMs: number;
  expiresAtMs: number;
  idleTimeoutMs: number;
}

/** Live infrastructure snapshot. The org is bound into the signed URL;
 * callers must derive it from authenticated membership, never user input. */
export async function sandboxCapacity(
  organizationId: string,
): Promise<SandboxCapacityObservation> {
  const path = `/v1/capacity?organizationId=${encodeURIComponent(organizationId)}`;
  const response = await spawnerFetch('GET', path, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Sandbox capacity unavailable (${response.status})`);
  return sandboxCapacitySchema.parse(await response.json());
}

/** The spawner's current configured ceiling, independent of host telemetry,
 * plus the slots the organization's connected devices add. */
export async function sandboxDeploymentLimits(organizationId: string): Promise<{
  maxSessions: number;
  deviceSessions?: number;
}> {
  const response = await spawnerFetch(
    'GET',
    `/v1/limits?organizationId=${encodeURIComponent(organizationId)}`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (response.status === 404) {
    // A running older spawner already reports its configured global ceiling
    // through capacity. Read that endpoint afresh for this authenticated org;
    // its deprecated organizationLimit is a different limit and must not win.
    const capacity = await sandboxCapacity(organizationId);
    return { maxSessions: capacity.sessions.limit };
  }
  if (!response.ok)
    throw new Error(
      `Sandbox deployment limits unavailable (${response.status})`,
    );
  return sandboxDeploymentLimitsSchema.parse(await response.json());
}

const acquisitionSchema = z.object({ generation: z.string().min(1) });

/** The organization's connected devices, as the spawner's hub sees them. An
 * older spawner (no device routes) has none. */
export async function sandboxDevices(
  organizationId: string,
): Promise<HubDevices> {
  const response = await spawnerFetch(
    'GET',
    `/v1/devices?organizationId=${encodeURIComponent(organizationId)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (response.status === 404) return { hub: false, devices: [] };
  if (!response.ok)
    throw new Error(`Sandbox devices unavailable (${response.status})`);
  return hubDevicesSchema.parse(await response.json());
}

/** Cut a removed device's tunnel and forget where its sessions were. */
export async function sandboxDeviceDisconnect(
  deviceId: string,
): Promise<{ disconnected: boolean; placementsDropped: number }> {
  const response = await spawnerFetch(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/disconnect`,
    { body: '', signal: AbortSignal.timeout(10_000) },
  );
  if (response.status === 404) {
    return { disconnected: false, placementsDropped: 0 };
  }
  if (!response.ok)
    throw new Error(`Sandbox device disconnect failed (${response.status})`);
  return z
    .object({
      disconnected: z.boolean(),
      placementsDropped: z.number().int().nonnegative(),
    })
    .parse(await response.json());
}

/** Claim warm compute before staging any new work. A concurrent idle stop
 * finishes first; a definitive 404 then allows the caller to recreate it. */
export async function sessionAcquire(sessionId: string): Promise<boolean> {
  return traceSandboxPhase('acquire', async () => {
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/acquire`;
    const budget = new SpawnerRetryBudget();
    let response: Response;
    for (;;) {
      response = await spawnerFetchRetryingConnection(
        budget,
        'POST',
        path,
        () => ({ signal: AbortSignal.timeout(15_000) }),
      );
      await throwIfDeviceOffline(response);
      // `session_unavailable`: a create of the id is in flight, the backend
      // listing timed out, or the container is still starting — the
      // spawner says when to ask again (`retry-after`).
      if (response.status !== 503) break;
      const body = await safeText(response);
      const waitMs = body.includes('session_unavailable')
        ? budget.nextWaitMs(parseRetryAfterMs(response))
        : undefined;
      if (waitMs === undefined)
        throw new Error(`Sandbox acquisition unavailable (503): ${body}`);
      await sleep(waitMs);
    }
    if (response.status === 429) throw await spawnerBusyErrorOf(response);
    if (response.status === 404) {
      // Rolling upgrade: an old spawner has neither activity routes nor the
      // limits endpoint (and cannot pressure-reclaim compute). Only that
      // positively identified legacy protocol may use the old liveness door.
      const limits = await spawnerFetch('GET', '/v1/limits', {
        signal: AbortSignal.timeout(5_000),
      });
      if (limits.status === 404) return sessionIsAlive(sessionId);
      if (!limits.ok)
        throw new Error(
          `Sandbox acquisition protocol unavailable (${limits.status})`,
        );
      sandboxDeploymentLimitsSchema.parse(await limits.json());
      return false;
    }
    if (!response.ok)
      throw new Error(`Sandbox acquisition unavailable (${response.status})`);
    acquisitionSchema.parse(await response.json());
    return true;
  });
}

/** Capture BEFORE releasing the database allocation. The generation binds a
 * later release to this use, so a delayed job cannot release a newer turn. */
export async function sessionReleaseTicket(
  sessionId: string,
): Promise<string | null> {
  const response = await spawnerFetch(
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/release`,
    { signal: AbortSignal.timeout(2_000) },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Sandbox release ticket unavailable (${response.status})`);
  return acquisitionSchema.parse(await response.json()).generation;
}

/** Mark released compute eligible for pressure reclamation; never stop it
 * here. The runtime still arbitrates pinning and active operations. */
export async function sessionReleaseIdle(
  sessionId: string,
  generation: string,
): Promise<boolean> {
  const response = await spawnerFetch(
    'POST',
    `/v1/sessions/${encodeURIComponent(sessionId)}/release`,
    {
      body: JSON.stringify({ generation }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`Sandbox idle release unavailable (${response.status})`);
  return z.object({ released: z.boolean() }).parse(await response.json())
    .released;
}

const CREATE_TIMEOUT_MS = 240_000; // bounded creation (180s) plus failed-start cleanup
// Drain-retry for session create. A 503 "draining" means the spawner is being
// rolled in place at deploy time — it refuses NEW sessions while it drains
// in-flight work before its restart. Re-POST so the create lands once the
// recreated spawner is back up, mirroring spawner_client's one-shot drain-retry.
// Bounded so a genuinely down tier still fails fast instead of looping.
const CREATE_DRAIN_RETRY_MAX = 5;
const CREATE_DRAIN_RETRY_DELAY_MS = 400;
// Grace added to the caller's exec timeoutMs for the SSE fetch, so the stream
// outlives the sandbox-side exec deadline and delivers the terminal result
// instead of aborting first (the old code hardcoded 60s here too).
const EXEC_FETCH_GRACE_MS = 60_000;
// Fallback fetch deadline when a caller omits timeoutMs. Env-tunable; the
// real value is supplied per-turn by run_external_agent (TURN_TIMEOUT_MS). The
// per-action window (ACTION_WINDOW_MS) aborts the fetch far sooner via the
// budget controller, so this is just the outer bound.
const EXEC_FALLBACK_TIMEOUT_MS = Number(
  process.env.EXTERNAL_AGENT_TURN_TIMEOUT_MS ?? String(24 * 60 * 60 * 1000),
);
// Resilient-drain reconnect bounds: max CONSECUTIVE failed re-attaches (reset on
// progress) before giving up, and the linear backoff between them.
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;
// Per-read idle deadline on the exec SSE. The spawner sends a `: keepalive`
// comment every 20s, so a healthy connection (even during a long, silent agent
// phase) never trips this; only a wedged/half-open socket does → re-attach.
// 3× the keepalive cadence tolerates a couple of dropped keepalives.
const IDLE_READ_TIMEOUT_MS = Number(
  process.env.EXTERNAL_AGENT_IDLE_READ_MS ?? 60_000,
);

/**
 * POST /v1/sessions — create + wait for runnerd ready. Throws on 4xx/5xx.
 * Targets the bare `sandbox` alias.
 */
export function sessionCreate(
  body: SessionCreateBody,
): Promise<SessionCreateResult> {
  return traceSandboxPhase('acquire', () => createSession(body));
}

async function createSession(
  body: SessionCreateBody,
): Promise<SessionCreateResult> {
  const path = '/v1/sessions';
  const bodyJson = JSON.stringify(body);
  const budget = new SpawnerRetryBudget();
  let drainRetries = 0;
  // Re-sign per attempt: each retry needs a fresh timestamp (clock-skew window)
  // and a fresh nonce (spawner replay cache) — see signedHeaders.
  for (;;) {
    const res = await spawnerFetchRetryingConnection(
      budget,
      'POST',
      path,
      () => ({
        body: bodyJson,
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      }),
    );
    if (res.status === 409) throw new SessionDuplicateError(body.sessionId);
    if (res.status === 429) throw await spawnerBusyErrorOf(res);
    // 503 "draining": the targeted colour is mid-flip. Re-POST so the bare
    // `sandbox` alias re-resolves onto the now-active colour. A 503 for an
    // offline device is final for this create: the session's workspace lives
    // there. A 503 `session_unavailable` (a create of the id already in
    // flight, the backend listing timed out) is asked again at its
    // `retry-after`, within the create's retry budget. Any other 503, or
    // exhausted retries, falls through to the generic failure below.
    if (res.status === 503) {
      const peek = await safeText(res);
      const offline = deviceOfflineIn(res, peek);
      if (offline) throw offline;
      if (peek.includes('draining') && drainRetries < CREATE_DRAIN_RETRY_MAX) {
        drainRetries += 1;
        await sleep(CREATE_DRAIN_RETRY_DELAY_MS);
        continue;
      }
      const waitMs = peek.includes('session_unavailable')
        ? budget.nextWaitMs(parseRetryAfterMs(res))
        : undefined;
      if (waitMs !== undefined) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`sandbox session create failed (503): ${peek}`);
    }
    if (!res.ok) {
      throw new Error(
        `sandbox session create failed (${res.status}): ${await safeText(res)}`,
      );
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const parsed = (await res.json()) as { session: SessionInfo };
    return { session: parsed.session };
  }
}

/** DELETE /v1/sessions/:id — idempotent teardown. */
/** GET /v1/sessions/:id — is the session alive spawner-side? `false` ONLY on
 * a definitive 404 (the phantom-session signal); transport errors throw so a
 * spawner blip is never misread as "session gone". */
export async function sessionIsAlive(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}`;
  const res = await spawnerFetch('GET', path, {
    signal: AbortSignal.any([
      AbortSignal.timeout(15_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (res.status === 404) return false;
  await throwIfDeviceOffline(res);
  if (!res.ok) {
    throw new Error(`sandbox session get failed (${res.status})`);
  }
  return true;
}

/** The runtime's current pin, for bidirectional drift repair. Absence is
 * definitive; an omitted pin is an older protocol, never evidence to unpin. */
export async function sessionObserve(
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ pinned?: boolean; pinSynchronized?: boolean } | null> {
  const res = await spawnerFetch(
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      signal: AbortSignal.any([
        AbortSignal.timeout(15_000),
        ...(signal ? [signal] : []),
      ]),
    },
  );
  if (res.status === 404) return null;
  await throwIfDeviceOffline(res);
  if (!res.ok) throw new Error(`sandbox session get failed (${res.status})`);
  const observed = z
    .object({
      session: z.object({
        pinned: z.boolean().optional(),
        pinSynchronized: z.boolean().optional(),
      }),
    })
    .safeParse(await res.json().catch(() => null));
  return observed.success ? observed.data.session : {};
}

/** Returns true when the spawner destroyed a live session, false when it had
 * nothing under that id (both mean "backend is gone"). THROWS on any non-2xx
 * so callers can't mistake a failed teardown for a clean one — flipping the
 * platform row while the backend survives leaves the deterministic sessionId
 * 409ing on every future create. A session on a device that is not connected
 * throws {@link SandboxDeviceOfflineError}: its workspace is still there. */
export async function sessionDestroy(sessionId: string): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}`;
  const res = await spawnerFetch('DELETE', path, {
    signal: AbortSignal.timeout(30_000),
  });
  await throwIfDeviceOffline(res);
  if (!res.ok) {
    throw new Error(`sandbox session destroy failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { destroyed?: boolean };
  return parsed.destroyed === true;
}

/** Conditional destroy (`?if_idle=1`): the spawner no-ops with {busy:true}
 * when the session still has a live exec — a janitor caller (the end-of-turn
 * thread-session teardown) must never kill a sibling turn's running code.
 * Busy is decided spawner-side (registry + runnerd's own counter); same
 * non-2xx THROW contract as sessionDestroy. */
export async function sessionDestroyIfIdle(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ destroyed: boolean; busy: boolean }> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}?if_idle=1`;
  const res = await spawnerFetch('DELETE', path, {
    signal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  await throwIfDeviceOffline(res);
  if (!res.ok) {
    throw new Error(`sandbox session destroy failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { destroyed?: boolean; busy?: boolean };
  return { destroyed: parsed.destroyed === true, busy: parsed.busy === true };
}

/** Conditional stop (`?if_idle=1&keep_workspace=1`): the spawner no-ops
 * with {busy:true} while the session still has a live exec, exactly as
 * {@link sessionDestroyIfIdle} does, and otherwise releases its compute and
 * KEEPS its workspace — the cleanup after a failed create of an agent
 * session, whose id may name a workspace preserved for its next turn (a
 * container lost to a host reboot or the OOM killer leaves exactly that).
 * Deleting a workspace nothing owns any more stays the workspace cleanup's
 * job. `workspaceKept: false` is the answer of a spawner or device older
 * than the flag, which destroyed instead. Same non-2xx THROW contract as
 * sessionDestroy. */
export async function sessionStopIfIdle(
  sessionId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ stopped: boolean; busy: boolean; workspaceKept: boolean }> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}?if_idle=1&keep_workspace=1`;
  const res = await spawnerFetch('DELETE', path, {
    signal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  await throwIfDeviceOffline(res);
  if (!res.ok) {
    throw new Error(`sandbox session stop failed (${res.status})`);
  }
  const answer = z
    .object({
      stopped: z.boolean().optional(),
      destroyed: z.boolean().optional(),
      busy: z.boolean().optional(),
      workspaceKept: z.boolean().optional(),
    })
    .parse(await res.json());
  return {
    stopped: answer.stopped === true || answer.destroyed === true,
    busy: answer.busy === true,
    workspaceKept: answer.workspaceKept === true,
  };
}

/** How far deleting a destroyed workspace's bytes has come, as the spawner
 * answers a destroy: `done` (Docker: no trash entry of the id is left),
 * `pending` (still being deleted in the background), `failed` (the last
 * attempt failed; the next destroy has it tried again) or `handed_off`
 * (Kubernetes: the PVC delete was accepted, and the volume is its storage
 * provisioner's to delete under the storage class's reclaim policy). */
export type WorkspaceDeletion = 'done' | 'pending' | 'failed' | 'handed_off';

/** What a destroy answers the workspace cleanup. */
export interface WorkspaceDestroyAnswer {
  /** Something under the id was taken out of use. */
  destroyed: boolean;
  /** A condition refused the destroy: nothing was touched. */
  busy: boolean;
  /** Absent only from a spawner or device older than the deletion contract,
   * whose answer says nothing about the bytes (19776cf18 already deleted in
   * the background): the cleanup reads it as unconfirmed, never as done. */
  deletion?: WorkspaceDeletion;
}

const workspaceDestroyAnswerSchema = z.object({
  destroyed: z.boolean(),
  busy: z.boolean().default(false),
  deletion: z.enum(['done', 'pending', 'failed', 'handed_off']).optional(),
});

/** The workspace cleanup's destroy — its erasures, retirements and sweeps.
 * `ifStopped` deletes only the preserved workspace of a STOPPED session: the
 * spawner answers `{busy:true}` while any compute runs under the id (a turn
 * that just resumed it, before its first exec) or a create is in flight, and
 * `if_idle=1` rides along so a spawner or device that predates `if_stopped`
 * still refuses a session with a live exec. `ifIdle` alone refuses only a
 * live exec; neither (an erasure) deletes whatever runs.
 *
 * A destroy answers once the workspace is out of use, before its bytes are
 * gone; `?await_deletion=1` has the spawner wait a bounded time for them and
 * answer how far they came, so the cleanup settles a deletion only on
 * `done`. Same non-2xx THROW contract as sessionDestroy; a device that is
 * not connected throws {@link SandboxDeviceOfflineError}. */
export async function sessionDestroyWorkspace(
  sessionId: string,
  conditions: { ifIdle?: boolean; ifStopped?: boolean } = {},
): Promise<WorkspaceDestroyAnswer> {
  const query = new URLSearchParams();
  if (conditions.ifIdle === true || conditions.ifStopped === true) {
    query.set('if_idle', '1');
  }
  if (conditions.ifStopped === true) query.set('if_stopped', '1');
  query.set('await_deletion', '1');
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}?${query}`;
  const res = await spawnerFetch('DELETE', path, {
    signal: AbortSignal.timeout(60_000),
  });
  await throwIfDeviceOffline(res);
  if (!res.ok) {
    throw new Error(`sandbox session destroy failed (${res.status})`);
  }
  return workspaceDestroyAnswerSchema.parse(await res.json());
}

const workspaceInventorySchema = z.object({
  backend: z.enum(['docker', 'kubernetes']),
  workspaces: z.array(
    z.object({
      sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      touchedAtMs: z.number(),
      active: z.boolean(),
      pinned: z.boolean(),
      organizationId: z.string().optional(),
    }),
  ),
  organizations: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)),
});

export type SandboxWorkspaceInventory = z.infer<
  typeof workspaceInventorySchema
>;

/** GET /v1/workspaces — every workspace the spawner holds (stopped sessions'
 * preserved data included) and the organizations holding resources beyond
 * them. `null` from a spawner that predates the route; THROWS when the
 * spawner could not read its inventory, or once `signal` aborts (the read
 * gives up after 60 s on its own). */
export async function sandboxWorkspaceInventory(
  options: { signal?: AbortSignal } = {},
): Promise<SandboxWorkspaceInventory | null> {
  const res = await spawnerFetch('GET', '/v1/workspaces', {
    signal: AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`sandbox workspace inventory unavailable (${res.status})`);
  }
  return workspaceInventorySchema.parse(await res.json());
}

/** DELETE /v1/organizations/:id — a deleted organization's remaining
 * sessions and its resources beyond them (build helpers, networks, caches).
 * `null` from a spawner that predates the route; THROWS on any other
 * failure, including 409 while a create of the organization is in flight. */
export async function sandboxOrganizationTeardown(
  organizationId: string,
): Promise<{
  sessions: number;
  containers: number;
  volumes: number;
  networks: number;
} | null> {
  const res = await spawnerFetch(
    'DELETE',
    `/v1/organizations/${encodeURIComponent(organizationId)}`,
    { signal: AbortSignal.timeout(300_000) },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`sandbox organization teardown failed (${res.status})`);
  }
  return z
    .object({
      sessions: z.number().int().nonnegative(),
      containers: z.number().int().nonnegative(),
      volumes: z.number().int().nonnegative(),
      networks: z.number().int().nonnegative(),
    })
    .parse(await res.json());
}

/** PATCH /v1/sessions/:id/pin — toggle the spawner-side reaper exemption.
 * The platform row is durable intent; reconciliation observes runtime state
 * and repairs either direction when a patch fails, without refreshing TTL
 * for pins that already agree. */
export async function sessionSetPinned(
  sessionId: string,
  pinned: boolean,
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/pin`;
  const bodyJson = JSON.stringify({ pinned });
  const res = await spawnerFetch('PATCH', path, {
    body: bodyJson,
    signal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { pinned?: boolean };
  return parsed.pinned === pinned;
}

/** POST /v1/sessions/:id/exec/:execId/cancel — SIGTERM→SIGKILL the exec's
 * processes in the sandbox. Idempotent (false if the exec/session is gone).
 * The Stop-button path for external-agent turns; the run's own finalize then
 * persists the partial timeline + marks the message failed.
 *
 * `keepLeftovers` is a rotation's cancel (a steer's restart, which continues
 * the conversation in a new exec over the same workspace): only the exec's
 * own process group ends, and what the turn started outside it — a dev
 * server its shell tool backgrounded — is kept for the exec that takes over.
 * A spawner or runtime that predates the flag ignores it and ends
 * everything. */
export async function sessionCancelExec(
  sessionId: string,
  execId: string,
  opts: { keepLeftovers?: boolean } = {},
): Promise<boolean> {
  const query = opts.keepLeftovers === true ? '?leftovers=keep' : '';
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/cancel${query}`;
  const res = await spawnerFetch('POST', path, {
    body: '',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return false;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as { killed?: boolean };
  return parsed.killed === true;
}

/** Per-exec liveness, decoupled from `sessionIsAlive` (which is session-level). */
export type ExecLiveness =
  | { state: 'running'; startedAtMs?: number }
  | { state: 'exited'; exitCode: number | null }
  | { state: 'gone' };

/** GET /v1/sessions/:id/exec/:execId — probe an exec's liveness WITHOUT
 * consuming its stream. The restorative recovery watchdog keys off this:
 * `running` ⇒ re-attach/resume (the agent is the source of truth, still
 * working); `exited`/`gone` ⇒ finalize using the agent's real outcome. A 404 ⇒
 * `gone` (session lost OR exec evicted past runnerd's recent window); any other
 * non-2xx THROWS so a spawner blip is treated as "unknown" and the turn is left
 * for the next sweep — NEVER finalized on a transient error. */
export async function sessionExecStatus(
  sessionId: string,
  execId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExecLiveness> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}`;
  const res = await spawnerFetch('GET', path, {
    signal: AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (res.status === 404) return { state: 'gone' };
  if (!res.ok) {
    throw new Error(`sandbox exec status failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as {
    state?: string;
    startedAtMs?: number;
    exitCode?: number | null;
  };
  if (parsed.state === 'running') {
    return {
      state: 'running',
      ...(typeof parsed.startedAtMs === 'number'
        ? { startedAtMs: parsed.startedAtMs }
        : {}),
    };
  }
  if (parsed.state === 'exited') {
    return { state: 'exited', exitCode: parsed.exitCode ?? null };
  }
  return { state: 'gone' };
}

export interface SessionStageFile {
  /** Workspace-relative destination path. */
  path: string;
  /** Presigned URL the daemon fetches (exactly one of url/contentBase64). */
  url?: string;
  /** Inline bytes, base64 — for small control files (steer messages). */
  contentBase64?: string;
  /** Trusted immutable source identity. Runnerd verifies actual target bytes
   * against its own manifest before reusing them; this is never permission. */
  sourceId?: string;
  sha256?: string;
  cacheKey?: string;
}

export interface SessionStageResult {
  staged: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: string }>;
  /** Explicit acknowledgement of a managed-root reconciliation. */
  reconciled?: boolean;
}

interface StageOptions {
  signal?: AbortSignal;
  /** Directories this payload fully owns; absent files are pruned only after
   * every chunk staged successfully. Never name the workspace root. */
  replaceRoots?: string[];
  /** Probe inline hashes first, avoiding transfer of already verified bytes. */
  reuse?: boolean;
}

class StageRequestError extends Error {
  constructor(readonly status: number) {
    super(`sandbox session files stage failed (${status})`);
  }
}

/** Client-side serialized-body budget per stage POST. Deliberately far under
 * the spawner's maxRequestBodyBytes (2 MiB historically, 8 MiB now) so a
 * multi-skill or fat-subtree payload never 413s regardless of which spawner
 * build is running; the HMAC headers ride outside the body, so the envelope
 * math below is exact. */
export const STAGE_BODY_BUDGET_BYTES = 1.5 * 1024 * 1024;
const STAGE_MAX_FILES = 512;

// Serialized length of the request envelope around the files array:
// `{"files":[` + `]}`.
const STAGE_ENVELOPE_BYTES = Buffer.byteLength('{"files":[]}', 'utf8');

/**
 * Pack stage files into batches whose SERIALIZED request body stays under
 * `maxBodyBytes`, preserving order. Pure — exported for unit tests. Uses the
 * exact JSON length (per-entry serialized bytes + separating commas +
 * envelope), so a batch never exceeds the budget it was packed for. A single
 * entry that cannot fit on its own throws: chunking cannot help an oversize
 * file, and silently posting it would just 413 downstream.
 */
export function chunkStageFiles(
  files: SessionStageFile[],
  maxBodyBytes: number = STAGE_BODY_BUDGET_BYTES,
): SessionStageFile[][] {
  const batches: SessionStageFile[][] = [];
  let batch: SessionStageFile[] = [];
  let batchBytes = STAGE_ENVELOPE_BYTES;
  for (const file of files) {
    const entryBytes = Buffer.byteLength(JSON.stringify(file), 'utf8');
    if (STAGE_ENVELOPE_BYTES + entryBytes > maxBodyBytes) {
      throw new Error(
        `stage file "${file.path}" serializes to ${entryBytes} bytes — over the ` +
          `${maxBodyBytes}-byte request budget; it cannot be staged inline`,
      );
    }
    const commaBytes = batch.length > 0 ? 1 : 0;
    if (
      batch.length >= STAGE_MAX_FILES ||
      batchBytes + commaBytes + entryBytes > maxBodyBytes
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = STAGE_ENVELOPE_BYTES;
    }
    batch.push(file);
    batchBytes += (batch.length > 1 ? 1 : 0) + entryBytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** One raw stage POST — no chunking. Kept private; callers go through
 * sessionStageFiles so every payload is budget-packed. */
async function postStageFiles(
  sessionId: string,
  files: SessionStageFile[],
  reconcile?: { replaceRoots: string[]; keepPaths: string[] },
  callerSignal?: AbortSignal,
): Promise<SessionStageResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files/stage`;
  const bodyJson = JSON.stringify({ files, ...reconcile });
  if (Buffer.byteLength(bodyJson) > STAGE_BODY_BUDGET_BYTES) {
    throw new Error('Sandbox staging manifest exceeds the request budget');
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(callerSignal ? [callerSignal] : []),
  ]);
  for (;;) {
    signal.throwIfAborted();
    const res = await spawnerFetch('POST', path, { body: bodyJson, signal });
    if (res.status === 404) throw new SessionNotFoundError(sessionId);
    if (res.status === 503) {
      const refusal: unknown = await res.json().catch(() => null);
      if (
        refusal === null ||
        typeof refusal !== 'object' ||
        !('error' in refusal) ||
        refusal.error !== 'busy'
      ) {
        throw new StageRequestError(res.status);
      }
    } else {
      if (!res.ok) throw new StageRequestError(res.status);
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const result = (await res.json()) as SessionStageResult;
      if (
        result.staged.length > 0 ||
        result.skipped.length === 0 ||
        result.skipped.some((file) => file.reason !== 'busy')
      )
        return result;
    }
    // Runnerd refuses admission before mutation when two transfers are busy,
    // or a final prune must wait for another staging request. Keep the queue
    // in the caller, bounded by this batch's one deadline, rather than retain
    // arbitrary request bodies inside the memory-constrained daemon.
    await delay(50 + Math.floor(Math.random() * 200), undefined, { signal });
  }
}

/** POST /v1/sessions/:id/files/stage — write files into the session workspace.
 * Large payloads are auto-chunked into sequential POSTs, each packed under
 * STAGE_BODY_BUDGET_BYTES, so callers can hand over whole skill bundles
 * without tripping the spawner's request-body cap. Throws on transport/HTTP
 * failure of any chunk; per-file failures come back merged in `skipped`. */
export async function sessionStageFiles(
  sessionId: string,
  files: SessionStageFile[],
  options: StageOptions = {},
): Promise<SessionStageResult> {
  return traceSandboxPhase('stage', async () => {
    options.signal?.throwIfAborted();
    // A previous node (or the agent) can replace a managed directory with a
    // file/link. Prepare directory roots even for an empty desired manifest. Intact
    // directory contents stay available for current-byte verification; the
    // daemon prunes stale children only after every transfer succeeds.
    for (const root of new Set(options.replaceRoots ?? [])) {
      // An explicitly staged root file is not a directory to prepare.
      if (files.some((file) => file.path === root.replace(/\/$/, ''))) continue;
      if (
        (await sessionListFiles(sessionId, root, {
          signal: options.signal,
        })) !== null
      )
        continue;
      const cleared = await sessionDeleteFiles(sessionId, [root], {
        signal: options.signal,
      });
      if (cleared.skipped.length > 0) {
        throw new Error(
          `managed staging roots could not be prepared: ${cleared.skipped.map((file) => file.path).join(', ')}`,
        );
      }
    }
    const merged: SessionStageResult = { staged: [], skipped: [] };
    // An inline file is identified by the digest of its bytes, and the digest
    // rides the probe too: a runtime that lost its record of what it staged
    // (every restart of a stopped session) checks the file already on disk
    // against it instead of having the bytes sent again.
    const identified = options.reuse
      ? files.map((file) => {
          if (file.contentBase64 === undefined) return file;
          const sha256 = createHash('sha256')
            .update(Buffer.from(file.contentBase64, 'base64'))
            .digest('hex');
          return { ...file, sha256, sourceId: `sha256:${sha256}` };
        })
      : files;
    let missing = identified;
    if (
      options.reuse &&
      identified.length > 0 &&
      identified.every((file) => file.sourceId !== undefined)
    ) {
      try {
        const hits = new Map<string, { path: string; bytes: number }>();
        for (const batch of chunkStageFiles(
          identified.map(({ path, sourceId, sha256 }) => ({
            path,
            sourceId,
            ...(sha256 !== undefined ? { sha256 } : {}),
          })),
        )) {
          const probe = await postStageFiles(
            sessionId,
            batch,
            undefined,
            options.signal,
          );
          // Legacy runtimes may accept a source-only entry but report no_source;
          // only explicit staged paths count as verified cache hits.
          for (const hit of probe.staged) {
            if (typeof hit === 'object' && typeof hit.path === 'string')
              hits.set(hit.path, hit);
          }
        }
        missing = identified.filter((file) => !hits.has(file.path));
        merged.staged.push(...hits.values());
      } catch (error) {
        // Old controls reject source-only probes. Their normal stage path still
        // works during rolling upgrades; other failures must remain visible.
        if (!(error instanceof StageRequestError && error.status === 400))
          throw error;
      }
    }
    for (const batch of chunkStageFiles(missing)) {
      const result = await postStageFiles(
        sessionId,
        batch,
        undefined,
        options.signal,
      );
      merged.staged.push(...result.staged);
      merged.skipped.push(...result.skipped);
    }
    if (options.replaceRoots?.length && merged.skipped.length === 0) {
      const final = await postStageFiles(
        sessionId,
        [],
        {
          replaceRoots: options.replaceRoots,
          keepPaths: identified.map((file) => file.path),
        },
        options.signal,
      );
      merged.skipped.push(...final.skipped);
      if (final.skipped.length === 0 && final.reconciled !== true) {
        // A legacy runtime ignored the new reconciliation fields. Restore the
        // old clear-and-copy behavior so removed files cannot survive a roll.
        options.signal?.throwIfAborted();
        const cleared = await sessionDeleteFiles(
          sessionId,
          options.replaceRoots,
          { signal: options.signal },
        );
        if (cleared.skipped.length > 0) {
          merged.skipped.push(...cleared.skipped);
        } else {
          merged.staged = [];
          for (const batch of chunkStageFiles(identified)) {
            const result = await postStageFiles(
              sessionId,
              batch,
              undefined,
              options.signal,
            );
            merged.staged.push(...result.staged);
            merged.skipped.push(...result.skipped);
          }
        }
      }
    }
    options.signal?.throwIfAborted();
    return merged;
  });
}

export interface SessionDeleteResult {
  deleted: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/** POST /v1/sessions/:id/files/delete — remove paths (file or dir, recursive)
 * from the session workspace. Idempotent: an absent path counts as deleted, so
 * reconcile callers can run it unconditionally. Throws on transport/HTTP
 * failure; per-path failures come back in `skipped`. */
export async function sessionDeleteFiles(
  sessionId: string,
  paths: string[],
  options: { signal?: AbortSignal } = {},
): Promise<SessionDeleteResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files/delete`;
  const bodyJson = JSON.stringify({ paths });
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const res = await spawnerFetch('POST', path, {
    body: bodyJson,
    signal,
  });
  if (res.status === 404) throw new SessionNotFoundError(sessionId);
  if (!res.ok) {
    throw new Error(`sandbox session files delete failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as SessionDeleteResult;
}

export interface SessionFsEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  size: number;
  mtimeMs: number;
}

/** GET /v1/sessions/:id/files?path= — workspace directory listing. Returns
 * null when the path (or the session) is gone — callers treat that as "nothing
 * to reconcile", not an error. */
export async function sessionListFiles(
  sessionId: string,
  dirPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<SessionFsEntry[] | null> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(dirPath)}`;
  const signal = AbortSignal.any([
    AbortSignal.timeout(30_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  const res = await spawnerFetch('GET', path, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`sandbox session files list failed (${res.status})`);
  }
  const raw = await res.text();
  let parsed: { entries?: SessionFsEntry[] };
  try {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    parsed = JSON.parse(raw) as { entries?: SessionFsEntry[] };
  } catch (err) {
    // A 200 whose body is not the listing contract is an infra fault — the
    // old `?? []` here silently turned it into "no outputs" (a passing VAT
    // run then read as having produced nothing).
    throw new Error(
      `sandbox session files list returned a non-JSON 200 (${raw.slice(0, 120)})`,
      { cause: err },
    );
  }
  if (parsed.entries === undefined) {
    throw new Error(
      `sandbox session files list returned 200 without entries (${raw.slice(0, 120)})`,
    );
  }
  if (parsed.entries.length === 0) {
    console.warn(
      `[session_client] files list EMPTY for ${sessionId} ${dirPath} (body=${raw.slice(0, 80)})`,
    );
  }
  return parsed.entries;
}

/** A response body read into memory, refusing past `maxBytes`: first on
 * the declared length, then on the bytes as they arrive. */
async function readBodyCapped(
  res: Response,
  filePath: string,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch((error: unknown) => {
      console.warn(
        '[session_client] cancelling an oversized read failed:',
        error,
      );
    });
    throw new SessionFileTooLargeError(filePath, maxBytes);
  }
  if (res.body === null) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch((error: unknown) => {
          console.warn(
            '[session_client] cancelling an oversized read failed:',
            error,
          );
        });
        throw new SessionFileTooLargeError(filePath, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** GET /v1/sessions/:id/files/content?path= — raw bytes of a single workspace
 * file. Returns null on 404, which the spawner emits for a missing/unsafe path
 * AND for an over-cap file (runnerd's /fs/read caps at 20 MB and returns null →
 * 404) — the two are indistinguishable here, so callers treat null as "can't
 * serve" (a 404/413 at the boundary). The spawner serves
 * `application/octet-stream`; the returned contentType reflects whatever the
 * response carried so the caller can fall back when it's the generic type.
 * With `maxBytes`, a larger file throws {@link SessionFileTooLargeError}
 * before more than the cap is held in memory. */
export async function sessionReadFile(
  sessionId: string,
  filePath: string,
  options: { maxBytes?: number } = {},
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/files/content?path=${encodeURIComponent(filePath)}`;
  const res = await spawnerFetch('GET', path, {
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`sandbox session file read failed (${res.status})`);
  }
  const bytes =
    options.maxBytes === undefined
      ? await res.arrayBuffer()
      : await readBodyCapped(res, filePath, options.maxBytes);
  const contentType =
    res.headers.get('content-type') ?? 'application/octet-stream';
  return { bytes, contentType };
}

export interface SessionExecBody {
  execId: string;
  command?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  stdinBase64?: string;
  /** 'hold' keeps the child's stdin open for sessionWriteExecStdin pushes
   * (Claude Code --input-format stream-json). Default 'close'. */
  stdinMode?: 'close' | 'hold';
  /** Whether the spawner collects stdout/stderr into the terminal `result`
   * buffers. Default true (one-shot). The agent run passes false: its output is
   * consumed live (the collected buffer is unused for it), so collecting would
   * retain an unused output copy in the spawner. false streams from the
   * bounded runnerd journal; reaching its budget fails the exec explicitly. */
  collectOutput?: boolean;
  timeoutMs?: number;
}

export interface SessionStdinWriteResult {
  ok: boolean;
  /** Structured refusal from runnerd: NOT_FOUND (exec not live) /
   * STDIN_CLOSED (close-mode exec or EOF already sent) / BAD_LINE /
   * WRITE_FAILED. Callers fall back to file staging on any refusal. */
  reason?: string;
}

/** POST /v1/sessions/:id/exec/:execId/stdin — append one NDJSON line to a
 * held-open exec stdin and/or close it (eof). 404 (session gone) throws
 * SessionNotFoundError; other transport/HTTP failures throw plain errors;
 * structured refusals come back as {ok:false, reason}. */
export async function sessionWriteExecStdin(
  sessionId: string,
  execId: string,
  write: { dataBase64?: string; eof?: boolean },
): Promise<SessionStdinWriteResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/stdin`;
  const bodyJson = JSON.stringify({
    ...(write.dataBase64 !== undefined ? { b64: write.dataBase64 } : {}),
    ...(write.eof === true ? { eof: true } : {}),
  });
  const res = await spawnerFetch('POST', path, {
    body: bodyJson,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) throw new SessionNotFoundError(sessionId);
  if (!res.ok) {
    throw new Error(`sandbox session stdin write failed (${res.status})`);
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (await res.json()) as SessionStdinWriteResult;
}

export interface SessionExecResult {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  durationMs: number;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: { stdout: boolean; stderr: boolean };
  errorCode?: string;
  errorMessage?: string;
}

const execOutputSchema = z
  .object({
    text: z.string().optional(),
    b64: z.base64().optional(),
    seq: z.number().int().positive().optional(),
  })
  .refine((value) => value.text !== undefined || value.b64 !== undefined);

const execResultSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  stdoutBase64: z.base64(),
  stderrBase64: z.base64(),
  truncated: z.object({ stdout: z.boolean(), stderr: z.boolean() }),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
}) satisfies z.ZodType<SessionExecResult>;

const execErrorSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
});

const replayStartSchema = z.object({});
const replayCompleteSchema = z.object({
  throughSeq: z.number().int().nonnegative(),
});

export interface SessionExecCallbacks {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  /** Reconnect starts replaying historical bytes; lifecycle cuts must wait. */
  onReplayStarted?: () => void;
  /** The captured historical prefix has been delivered, before live follow. */
  onReplayComplete?: () => void;
}

/** A protocol or consumer failure cannot be repaired by replaying a later
 * suffix. Fail the turn visibly instead of advancing past corrupt state. */
class ExecAttachBusyError extends Error {}

export class ExecStreamProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExecStreamProtocolError';
  }
}

const execCheckpointSchema = z.object({
  seq: z.number().int().nonnegative(),
  state: z.unknown(),
});
export type SessionExecCheckpoint = z.infer<typeof execCheckpointSchema>;

/** The daemon stores parser state beside its replay spool. A 404 is the
 * rolling-upgrade fallback; attaching still determines whether the exec lives.
 * A transient read must get the same recovery opportunity as the following
 * attach: five retries, each bounded to 5s, with the reconnect backoff. */
export async function sessionGetExecCheckpoint(
  sessionId: string,
  execId: string,
): Promise<SessionExecCheckpoint | null> {
  // fetch reports malformed URL configuration as TypeError too. Refuse it
  // before classifying transport errors, without exposing URL credentials.
  let target: URL;
  try {
    target = new URL(getSpawnerUrl());
  } catch {
    throw new Error('Invalid SANDBOX_URL configuration');
  }
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new Error('Invalid SANDBOX_URL configuration');
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/checkpoint`;
  for (let attempt = 0; ; attempt += 1) {
    let transientStatus = false;
    try {
      const response = await spawnerFetch('GET', path, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        if (response.status === 404) {
          // No error body is needed. Release it rather than leaving the
          // connection alive until it is collected.
          void response.body?.cancel().catch((error: unknown) => {
            console.warn(
              '[session_client] releasing a checkpoint answer failed:',
              error,
            );
          });
          return null;
        }
        transientStatus = [408, 429, 500, 502, 503, 504].includes(
          response.status,
        );
        // Released by refusedAnswerErrorOf rather than kept alive through the
        // backoff; a device that is not connected is retried like any 503
        // and then named, never taken for the spawner being away.
        throw await refusedAnswerErrorOf(
          `sandbox exec checkpoint read failed (${response.status})`,
          response,
        );
      }
      return z
        .object({ checkpoint: execCheckpointSchema.nullable() })
        .parse(await response.json()).checkpoint;
    } catch (error) {
      const transient =
        transientStatus ||
        error instanceof SpawnerUnreachableError ||
        error instanceof TypeError ||
        (error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError'));
      if (!transient || attempt >= MAX_RECONNECT_ATTEMPTS) throw error;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(RECONNECT_BACKOFF_MS * (attempt + 1), MAX_BACKOFF_MS),
        ),
      );
    }
  }
}

/** Acknowledge only a complete cursor + parser snapshot. Oversized partial
 * JSONL records wait for their closing newline rather than acknowledging
 * bytes whose parser state cannot fit; the spool retains them meanwhile. */
export async function sessionPutExecCheckpoint(
  sessionId: string,
  execId: string,
  checkpoint: SessionExecCheckpoint,
): Promise<void> {
  const body = JSON.stringify(checkpoint);
  if (Buffer.byteLength(body) > 1024 * 1024) return;
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/checkpoint`;
  const response = await spawnerFetch('PUT', path, {
    body,
    signal: AbortSignal.timeout(5_000),
  });
  // A later checkpoint may have won on a concurrent recovering drainer.
  // Neither that nor an old runtime's absent endpoint justifies restarting.
  if (response.status === 404 || response.status === 409) return;
  if (!response.ok)
    throw new Error(
      `sandbox exec checkpoint write failed (${response.status})`,
    );
}

const execReplayGapSchema = z
  .object({
    fromSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    toSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .refine((range) => range.toSeq >= range.fromSeq);

/** Output outside the durable replay retention is not a valid parser prefix. */
export class ExecReplayGapError extends Error {
  readonly fromSeq: number | undefined;
  readonly toSeq: number | undefined;

  constructor(execId: string, range?: { fromSeq: number; toSeq: number }) {
    super(
      `sandbox exec ${execId} output is no longer available for lossless replay`,
    );
    this.name = 'ExecReplayGapError';
    this.fromSeq = range?.fromSeq;
    this.toSeq = range?.toSeq;
  }
}

/** Missing earlier control/output records cannot be repaired by reattaching. */
export class ExecOutputGapError extends ExecStreamProtocolError {
  readonly code = 'OUTPUT_GAP';
}

/** The session's runtime could not write the exec's output because the
 * sandbox host's disk is full (runnerd's `REPLAY_DISK_FULL`), and ended the exec: a
 * condition of the host, not a lost transcript, so it says so in its own
 * words. Reattaching cannot help. */
export class ExecDiskFullError extends ExecStreamProtocolError {
  readonly code = 'REPLAY_DISK_FULL';
  constructor() {
    super('the sandbox host ran out of disk space');
  }
}

/**
 * POST /v1/sessions/:id/exec as SSE. Streams stdout/stderr deltas to the
 * callbacks (the progress-bridge action feeds these through the agent adapter
 * parser) and returns the terminal result. The raw stdout deltas are exactly
 * the agent's stream-json / JSONL bytes — byte-faithful and ordered.
 */
async function sessionExec(
  sessionId: string,
  body: SessionExecBody,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  cursor?: ExecCursor,
  onAttached?: () => void,
): Promise<SessionExecResult> {
  const path = `/v1/sessions/${encodeURIComponent(sessionId)}/exec`;
  const bodyJson = JSON.stringify(body);
  // One healthy connection holds for the whole turn (timeoutMs + grace); the
  // resilient drain only re-attaches when this connection actually DROPS before
  // the terminal result (network blip / spawner restart), not on a fixed cycle.
  const subscription = new AbortController();
  const fetchAbort = AbortSignal.any([
    signal,
    subscription.signal,
    AbortSignal.timeout(
      (body.timeoutMs ?? EXEC_FALLBACK_TIMEOUT_MS) + EXEC_FETCH_GRACE_MS,
    ),
  ]);
  try {
    const res = await spawnerFetch('POST', path, {
      body: bodyJson,
      accept: 'text/event-stream; tale-output=base64',
      signal: fetchAbort,
    });
    if (res.status === 404) throw new SessionNotFoundError(sessionId);
    if (!res.ok || !res.body) {
      throw await refusedAnswerErrorOf(
        `sandbox session exec failed (${res.status})`,
        res,
      );
    }
    return await consumeExecSse(
      res.body,
      body.execId,
      callbacks,
      cursor,
      false,
      onAttached,
    );
  } finally {
    // Own this attachment's transport without aborting the caller's turn.
    subscription.abort();
  }
}

/**
 * GET /v1/sessions/:id/exec/:execId/attach?sinceSeq= as SSE — reconnect to a
 * running (or just-finished) exec and resume the stream from `sinceSeq`. Same
 * event grammar + return as sessionExec; throws on a non-terminal end so the
 * drain retries. The detach-grace on runnerd keeps the child alive across the
 * gap, and the seq cursor makes the replay idempotent.
 */
async function sessionAttachExec(
  sessionId: string,
  execId: string,
  sinceSeq: number,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  cursor?: ExecCursor,
  timeoutMs?: number,
  onAttached?: () => void,
): Promise<SessionExecResult> {
  callbacks.onReplayStarted?.();
  const query = sinceSeq > 0 ? `?sinceSeq=${sinceSeq}` : '';
  // The spawner verifies the HMAC over pathname+search, so the signed string
  // MUST include the query — signing the bare path 401s every re-attach with
  // a non-zero cursor (i.e. every real continuation), which silently killed
  // the resilient drain + the stdin-steering continuation path.
  const signedPath = `/v1/sessions/${encodeURIComponent(sessionId)}/exec/${encodeURIComponent(execId)}/attach${query}`;
  const subscription = new AbortController();
  const fetchAbort = AbortSignal.any([
    signal,
    subscription.signal,
    AbortSignal.timeout(
      (timeoutMs ?? EXEC_FALLBACK_TIMEOUT_MS) + EXEC_FETCH_GRACE_MS,
    ),
  ]);
  try {
    const res = await spawnerFetch('GET', signedPath, {
      accept: 'text/event-stream; tale-output=base64',
      signal: fetchAbort,
    });
    if (res.status === 404) throw new SessionNotFoundError(sessionId);
    if (!res.ok || !res.body) {
      throw await refusedAnswerErrorOf(
        `sandbox session attach failed (${res.status})`,
        res,
      );
    }
    return await consumeExecSse(
      res.body,
      execId,
      callbacks,
      cursor,
      true,
      onAttached,
    );
  } finally {
    subscription.abort();
  }
}

/**
 * Resilient drain: run an exec and, on any NON-terminal end (connection drop,
 * window timeout, transient error), re-attach via sinceSeq and keep going until
 * the terminal result — so a single turn is no longer bound to one HTTP
 * connection. The same callbacks (hence the same in-memory parser) are fed
 * across reconnects; the cursor guarantees no missed or double-counted events.
 *
 * Bounded by MAX_RECONNECT_ATTEMPTS *consecutive* failures (reset whenever a
 * reconnect makes progress) so a truly-dead exec doesn't loop forever; a
 * caller-aborted signal stops immediately (an explicit Stop already yields a
 * terminal 'cancelled' result, so it doesn't reach here).
 *
 * A caller that passes `contact` rides out a spawner outage instead: a
 * transport failure ({@link isSpawnerTransportFailure} — a restart, a
 * partition, a "not now" answer) costs none of that budget. The drain waits
 * the spawner's `retry-after`, or a backoff doubling from 250 ms to 5 s, and
 * attaches again, for as long as the caller's signal lets it run; `contact`
 * hears when the stream is lost and when it flows again, so the caller can
 * bound the outage across its windows. Only a caller whose signal ends the
 * drain may pass it.
 */
export async function drainSessionExecResilient(
  sessionId: string,
  body: SessionExecBody,
  signal: AbortSignal,
  callbacks: SessionExecCallbacks = {},
  opts: {
    cursor?: ExecCursor;
    resumeSinceSeq?: number;
    contact?: ExecStreamContact;
  } = {},
): Promise<SessionExecResult> {
  // External cursor lets the caller (run_agent) read the resume position; on a
  // continuation it starts at the handoff seq. `resumeSinceSeq` makes the FIRST
  // attempt an attach (no new exec — the exec is already running in the sandbox).
  const cursor: ExecCursor = opts.cursor ?? {
    lastSeq: opts.resumeSinceSeq ?? 0,
  };
  const startWithAttach = opts.resumeSinceSeq !== undefined;
  let attempt = 0;
  let seqAtAttemptStart = cursor.lastSeq;
  // Whether the next attempt (re)POSTs the exec instead of attaching. A fresh
  // turn POSTs once and every retry attaches — EXCEPT when the spawner has just
  // answered that it knows no such exec and this drain has consumed nothing
  // from it: then the original POST never landed (a network drop or a 503
  // mid-roll swallowed it), and attaching again would fail identically until
  // the whole budget was gone. Re-POSTing creates it. Never after progress —
  // an exec that produced output existed, and re-running it would execute
  // the turn twice — and never on a resume, whose caller owns that recovery.
  let recreate = !startWithAttach;
  // The outage being ridden out (with `contact`): when the stream was lost,
  // and the waits between attempts, which start short again after it flows.
  let outage: { since: number; budget: SpawnerRetryBudget } | undefined;
  const onAttached = () => {
    if (outage !== undefined) {
      console.warn(
        `[session_client] exec ${body.execId}: the spawner serves the stream again after ${Date.now() - outage.since} ms`,
      );
      outage = undefined;
    }
    opts.contact?.onAttached();
  };
  for (;;) {
    try {
      if (recreate) {
        recreate = false;
        return await sessionExec(
          sessionId,
          body,
          signal,
          callbacks,
          cursor,
          onAttached,
        );
      }
      return await sessionAttachExec(
        sessionId,
        body.execId,
        cursor.lastSeq,
        signal,
        callbacks,
        cursor,
        body.timeoutMs,
        onAttached,
      );
    } catch (err) {
      if (signal.aborted) throw err;
      // A 404 means the session is gone, not a transient drop — retrying can't
      // help. Surface it so the caller self-heals the stale platform row.
      if (err instanceof SessionNotFoundError) throw err;
      if (err instanceof ExecReplayGapError) throw err;
      if (err instanceof ExecOutputConsumerError) throw err.cause;
      if (err instanceof ExecStreamProtocolError) throw err;
      if (err instanceof ExecAttachBusyError) {
        // Reader admission is temporary pressure, not a failure of the exec.
        // Keep retrying this attach within the action/window cancellation.
        await delay(RECONNECT_BACKOFF_MS, undefined, { signal });
        continue;
      }
      // An idle SSE (no keepalive) is a wedged socket, NOT an exec failure: a
      // live-but-quiet exec resumes losslessly via sinceSeq, and a genuinely
      // dead sandbox surfaces as a real fetch error on the next re-attach
      // (counted below). Re-attach immediately without consuming the budget so
      // an arbitrarily long quiet phase can never exhaust MAX_RECONNECT_ATTEMPTS
      // — the only bound on a quiet phase is the action window (signal abort).
      if (err instanceof ExecStreamIdleError) {
        opts.contact?.onLost(err);
        seqAtAttemptStart = cursor.lastSeq;
        continue;
      }
      // Progress since the last failure resets the consecutive-failure budget.
      if (cursor.lastSeq > seqAtAttemptStart) attempt = 0;
      seqAtAttemptStart = cursor.lastSeq;
      if (opts.contact !== undefined && isSpawnerTransportFailure(err)) {
        opts.contact.onLost(err);
        if (outage === undefined) {
          outage = {
            since: Date.now(),
            budget: new SpawnerRetryBudget(Number.POSITIVE_INFINITY),
          };
          console.warn(
            `[session_client] exec ${body.execId} lost its stream to the transport (sinceSeq=${cursor.lastSeq}); attaching again until the spawner answers:`,
            err instanceof Error ? err.message : String(err),
          );
        }
        const waitMs =
          outage.budget.nextWaitMs(
            err instanceof SpawnerStatusError ? err.retryAfterMs : undefined,
          ) ?? SPAWNER_TRANSIENT_RETRY_MAX_MS;
        await sleepUnlessAborted(waitMs, signal);
        continue;
      }
      attempt += 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) throw err;
      recreate =
        !startWithAttach &&
        cursor.lastSeq === 0 &&
        err instanceof ExecNotFoundError;
      console.warn(
        `[session_client] exec ${body.execId} stream dropped (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}, sinceSeq=${cursor.lastSeq}); ${recreate ? 're-creating the exec (the spawner does not know it)' : 're-attaching'}:`,
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) =>
        setTimeout(r, Math.min(RECONNECT_BACKOFF_MS * attempt, MAX_BACKOFF_MS)),
      );
    }
  }
}

/** Reconnect cursor: the highest runnerd event `seq` consumed so far. A
 * resilient drain passes this so a re-attach replays only newer events. */
export interface ExecCursor {
  lastSeq: number;
}

class ExecOutputConsumerError extends Error {
  constructor(cause: unknown) {
    super('Sandbox exec output consumer failed', { cause });
  }
}

// Decoding is part of the cursor's in-memory state: a runnerd chunk can end
// halfway through a UTF-8 character, including at a transport reconnect.
const cursorDecoders = new WeakMap<
  ExecCursor,
  { stdout: TextDecoder; stderr: TextDecoder }
>();

const SSE_FRAME_MAX_CHARS = 16 * 1024 * 1024;

/** The library bounds retained data, but complete events can dispatch before
 * its buffer check, and ignored fields/comments do not enter its buffer.
 * Keep our whole-frame limit independently, with counters only. Line endings
 * count as LF across arbitrary chunks; the terminating blank line is excluded.
 * Each incoming character is examined once, never the buffered prefix. */
class SseFrameBudget {
  private frameChars = 0;
  private lineChars = 0;
  private skipLineFeed = false;

  accept(chunk: string): void {
    for (let at = 0; at < chunk.length; at += 1) {
      const code = chunk.charCodeAt(at);
      if (this.skipLineFeed && code === 10) {
        this.skipLineFeed = false;
        continue;
      }
      this.skipLineFeed = code === 13;
      if (code === 10 || code === 13) {
        // A non-empty line's terminator may be the first half of the blank
        // separator; charge it only if another non-empty line follows.
        this.frameChars = this.lineChars === 0 ? 0 : this.frameChars + 1;
        this.lineChars = 0;
      } else {
        this.lineChars += 1;
        this.frameChars += 1;
        if (this.frameChars > SSE_FRAME_MAX_CHARS) {
          throw new ExecStreamProtocolError('Sandbox SSE frame exceeds 16 MiB');
        }
      }
    }
  }
}

async function consumeExecSse(
  body: ReadableStream<Uint8Array>,
  execId: string,
  callbacks: SessionExecCallbacks,
  cursor?: ExecCursor,
  attaching = false,
  /** Called once, at the stream's first bytes: the spawner serves the exec
   * again. Not at the response headers — a connection that is accepted and
   * cut before a byte arrives has not reached the exec. */
  onAttached?: () => void,
): Promise<SessionExecResult> {
  const reader = body.getReader();
  let delivered = false;
  const decoder = new TextDecoder('utf-8');
  const frameBudget = new SseFrameBudget();
  let result: SessionExecResult | null = null;
  const outputDecoders = (cursor && cursorDecoders.get(cursor)) || {
    stdout: new TextDecoder('utf-8', { ignoreBOM: true }),
    stderr: new TextDecoder('utf-8', { ignoreBOM: true }),
  };
  if (cursor) cursorDecoders.set(cursor, outputDecoders);
  let replay: 'unknown' | 'journal' | 'complete' = attaching
    ? 'unknown'
    : 'complete';
  let journal = false;
  const completeReplay = () => {
    if (replay === 'complete') return;
    replay = 'complete';
    callbacks.onReplayComplete?.();
  };
  const handleEvent = (event: string, data: string): void => {
    if (event === 'replay-start') {
      parseExecData(data, replayStartSchema, event);
      journal = true;
      if (attaching) replay = 'journal';
      return;
    }
    if (event === 'stdout' || event === 'stderr') {
      const parsed = parseExecData(data, execOutputSchema, event);
      const bytes =
        parsed.b64 === undefined
          ? undefined
          : Buffer.from(parsed.b64, 'base64');
      // The schema checks syntax; the round trip also rejects nonzero padding
      // bits. Validate before changing replay state or the reconnect cursor.
      if (bytes !== undefined && bytes.toString('base64') !== parsed.b64)
        throw new ExecStreamProtocolError('Invalid sandbox output base64.');
      if (cursor && parsed.seq !== undefined && parsed.seq <= cursor.lastSeq)
        return;
      if (
        attaching &&
        !journal &&
        cursor &&
        parsed.seq !== undefined &&
        parsed.seq > Math.max(2, cursor.lastSeq + 1)
      ) {
        throw new ExecStreamProtocolError(
          'Legacy sandbox replay is incomplete; earlier output was evicted',
        );
      }
      // Older runtimes/spawners lack journal markers. A contiguous legacy
      // replay retains its old progress and completion behavior; a visible
      // ring rollover is refused instead of reconstructing partial state.
      if (replay === 'unknown') completeReplay();
      // Include these bytes in a checkpoint taken synchronously by the
      // consumer; a rejected record rolls back the candidate cursor below.
      const previousSeq = cursor?.lastSeq;
      if (cursor && typeof parsed?.seq === 'number')
        cursor.lastSeq = parsed.seq;
      try {
        const text =
          bytes !== undefined
            ? outputDecoders[event].decode(bytes, { stream: true })
            : (parsed.text ?? '');
        if (text !== '') {
          if (event === 'stdout') callbacks.onStdout?.(text);
          else callbacks.onStderr?.(text);
        }
      } catch (cause) {
        if (cursor !== undefined && previousSeq !== undefined)
          cursor.lastSeq = previousSeq;
        if (cause instanceof ExecStreamProtocolError) throw cause;
        throw new ExecOutputConsumerError(cause);
      }
    } else if (event === 'gap') {
      throw new ExecReplayGapError(
        execId,
        parseExecData(data, execReplayGapSchema, event),
      );
    } else if (event === 'replay-complete') {
      parseExecData(data, replayCompleteSchema, event);
      completeReplay();
    } else if (event === 'result') {
      const parsed = parseExecData(data, execResultSchema, event);
      if (replay === 'unknown') completeReplay();
      result = parsed;
    } else if (event === 'error') {
      const parsed = parseExecData(data, execErrorSchema, event);
      const message = parsed.message ?? 'sandbox session exec stream error';
      // The spawner's attach grammar for an unknown exec (session-routes.ts):
      // `exec <id> not found`.
      if (parsed?.code === 'ATTACH_BUSY')
        throw new ExecAttachBusyError(message);
      if (parsed?.code === 'OUTPUT_GAP') throw new ExecOutputGapError(message);
      if (parsed?.code === 'REPLAY_DISK_FULL') throw new ExecDiskFullError();
      if (message === `exec ${execId} not found`) {
        throw new ExecNotFoundError(execId);
      }
      if (parsed.code?.startsWith('REPLAY_') || parsed.code === 'OUTPUT_LIMIT')
        throw new ExecStreamProtocolError(message);
      throw new Error(message);
    }
  };
  const parser = createParser({
    maxBufferSize: SSE_FRAME_MAX_CHARS,
    onEvent: ({ event, data }) => handleEvent(event ?? 'message', data),
    onError: (error) => {
      if (error.type === 'max-buffer-size-exceeded') {
        throw new ExecStreamProtocolError('Sandbox SSE frame exceeds 16 MiB');
      }
    },
  });
  try {
    for (;;) {
      // Race each read against an idle deadline. The spawner's 20s `: keepalive`
      // comment feeds a healthy connection (even through a long silent agent
      // phase), so this only fires on a wedged/half-open socket → cancel + throw
      // a benign idle error the resilient drain re-attaches on (no failure-budget
      // cost). Without it a half-open read blocks until the hours-long fetch
      // deadline.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await Promise.race([
          // A read that fails is the connection breaking under the stream;
          // an abort is the caller's own cut and passes as it came.
          reader.read().catch((cause: unknown) => {
            if (cause instanceof Error && cause.name === 'AbortError')
              throw cause;
            throw new ExecStreamDroppedError(
              `sandbox exec ${execId} stream broke: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          }),
          new Promise<never>((_, reject) => {
            idleTimer = setTimeout(
              () => reject(new ExecStreamIdleError(execId)),
              IDLE_READ_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      const { value, done } = chunk;
      if (done) break;
      if (!delivered && value.byteLength > 0) {
        delivered = true;
        onAttached?.();
      }
      const text = decoder.decode(value, { stream: true });
      frameBudget.accept(text);
      parser.feed(text);
    }
    if (result === null) {
      throw new Error('sandbox session exec stream ended without a result');
    }
    try {
      const stdout = outputDecoders.stdout.decode();
      const stderr = outputDecoders.stderr.decode();
      if (stdout !== '') callbacks.onStdout?.(stdout);
      if (stderr !== '') callbacks.onStderr?.(stderr);
    } catch (cause) {
      throw new ExecStreamProtocolError(
        'Harness stream consumer failed at EOF',
        { cause },
      );
    }
    return result;
  } finally {
    // A transport drop must discard its incomplete event. Only the cursor's
    // accepted output decoder state survives a reconnect.
    parser.reset();
    // Cancellation acknowledgements can stall forever. Release the reader now;
    // the attachment owner also aborts its fetch before retrying or returning.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Called only after the SSE frame is complete. A broken JSON payload is not
 * a transport split: ignoring it would let later records advance the cursor
 * past lost lifecycle or usage facts. Keep raw payloads out of the refusal. */
function parseExecData<T>(
  data: string,
  schema: z.ZodType<T>,
  event: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new ExecStreamProtocolError(`Invalid sandbox ${event} event`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ExecStreamProtocolError(`Invalid sandbox ${event} event`);
  return parsed.data;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<unreadable>';
  }
}
