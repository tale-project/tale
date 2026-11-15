// Several Incus hosts behind one spawner (SANDBOX_INCUS_ENDPOINTS). Each host
// keeps its own pair of backends (IncusBackend, IncusSessionBackend), made
// from its own view of the config (incus-endpoints.ts): its own connection,
// certificates, warm pool, boot checks and session cap. This layer only
// decides which host a call goes to:
//
//  - A new session goes to the host with the most headroom
//    (incus-placement.ts) among those that are not drained, answer, passed
//    their boot checks and hold the runtime image. A host passed over is
//    logged with its reason, once per change of reason.
//  - A session stays on the host it was created on: its workspace volume is
//    there. Where it lives is a durable record (incus-placement-record.ts) on
//    the spawner's own data volume, written before the session is created,
//    so a restarted spawner knows it too. A recorded session is only ever
//    resumed on its recorded host, even a drained one (its session is one
//    the host already holds), within the host's cap; while that host does
//    not answer, or is no longer declared, the session is refused as
//    unavailable (503), never started elsewhere. A session the record does
//    not hold is new, and is placed freely.
//  - The record is rebuilt from every host's listings when there is none
//    (the first start with it), and a host it has never listed (one declared
//    since) is listed before a session the record does not hold is placed.
//    Until every declared host has been listed once, a session the record
//    does not hold may live on a host not yet listed, so it is refused as
//    unavailable too.
//  - A host that does not connect is skipped for new sessions, with the
//    reason logged, and not asked again for UNREACHABLE_RETRY_MS. A host that
//    answers, however slowly or with an error, is not: each Incus request
//    has its own timeout (SANDBOX_INCUS_API_TIMEOUT_MS), and only a failure
//    to connect, or a request with no answer within it, marks the host
//    unreachable. Its sessions are listed as last seen, so a blip does not
//    read as their end; a call for one of them fails, and the caller
//    retries. A host that is down from boot shows no session until it
//    answers.
//  - Every host must give a session the same shape (memory, disk): a new
//    session's need is judged once, by the first declared host's view.
//
// Every per-host check stays where it was: SANDBOX_MAX_SESSIONS is the whole
// spawner's cap, judged by the route layer over the union of the hosts'
// listings; each host's own cap, memory and disk are judged here; each
// project's limits are enforced by Incus itself.

import { IncusApiError } from '@tale/incus/api';
import { incusSizeBytes } from '@tale/incus/units';

import type { SpawnerConfig } from '../../types.ts';
import {
  type BackendSession,
  type BackendWorkspace,
  type CreateSessionResult,
  type HealthResult,
  type HostBackend,
  type OrganizationTeardownResult,
  type SessionBackend,
  SessionExistsError,
  SessionPlacementError,
  type SessionSpec,
  type StopSessionOptions,
  type SweepOptions,
  type WorkspaceDeletion,
} from '../types.ts';
import { IncusBackend } from './incus-backend.ts';
import { endpointLabel, incusEndpointConfigs } from './incus-endpoints.ts';
import {
  FilePlacementStore,
  type PlacementRecord,
  type PlacementStore,
} from './incus-placement-record.ts';
import {
  chooseEndpoint,
  type EndpointCandidate,
  type PlacementNeed,
  readProjectRoom,
  type Room,
  withStandbysFreed,
} from './incus-placement.ts';
import { getIncusRuntime } from './incus-runtime.ts';
import { IncusSessionBackend } from './incus-session-backend.ts';
import { incusOf, poolShape, sessionShape } from './incus-session-spec.ts';

/** A host that did not answer is left alone this long. */
export const UNREACHABLE_RETRY_MS = 30_000;
/** A host whose boot checks failed, or whose runtime image could not be made
 * present, is tried again this often. */
const INIT_RETRY_MS = 60_000;

/** The session backend of one host, with the calls this layer needs. */
export type EndpointSessionBackend = SessionBackend &
  Required<Pick<SessionBackend, 'hasWorkspace'>>;

/** One host: its backends, and what this layer reads of it. */
export interface EndpointParts {
  name: string;
  /** The host's own view of the config. */
  cfg: SpawnerConfig;
  drained: boolean;
  host: HostBackend;
  session: EndpointSessionBackend;
  /** Its project's memory and disk room (readProjectRoom). */
  room: () => Promise<{ memory?: Room; disk?: Room }>;
  /** The creates under way on it, which its listing may not show yet. */
  inFlight: () => ReadonlySet<string>;
  /** Removes the warm standbys of a drained host. */
  retireStandbys?: () => Promise<void>;
}

interface Endpoint extends EndpointParts {
  /** Its boot checks passed. */
  ready: boolean;
  /** Why its boot checks failed, while they do. */
  initError?: string;
  /** Its runtime image is present (warmImage succeeded). */
  imageReady: boolean;
  /** When it last failed to answer, and why. */
  failedAtMs?: number;
  failure?: string;
  /** Its sessions as last listed. */
  lastSessions?: BackendSession[];
  /** The reason it was last passed over for, as logged. */
  lastSkip?: string;
}

/** The answer to "which host holds this session?". */
type Home =
  | { endpoint: Endpoint }
  | { none: true }
  | {
      /** The hosts that may hold it and cannot be asked now. */
      unknown: readonly string[];
      /** The record names its host (else: a host not yet listed may hold
       * it). */
      recorded: boolean;
      /** Why it cannot be served now, for the refusal. */
      why: string;
    };

export interface EndpointSetDeps {
  /** Where the record of each session's host is kept. */
  record: PlacementStore;
  now?: () => number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Error codes of a connection that was never made, or broke: refused,
 * reset, unroutable, unresolvable or timed out (Node's and undici's, and
 * Bun's spellings). A TLS handshake that failed is `TLS_CODE`. */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EPROTO',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ConnectionRefused',
  'ConnectionClosed',
  'ConnectionReset',
  'FailedToOpenSocket',
]);

/** A TLS handshake that failed: the pinned certificate refused, or the
 * handshake broken (OpenSSL's, Node's and Bun's spellings). */
const TLS_CODE =
  /^(?:CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|UNKNOWN_CERTIFICATE_)/;

/**
 * The host did not answer: the connection failed (a network or TLS error
 * code, on the error or its `cause` as undici wraps it in a fetch's
 * TypeError), or a request got no answer within its own timeout. Anything
 * else is an answer: an Incus API error, any error the backend raises itself
 * (a refusal, a missing object), and a TypeError without such a code (a reply
 * that does not parse); the host is up. Follows the `cause` chain of a
 * wrapped error.
 */
export function isConnectionFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof IncusApiError) return false;
    if (current.name === 'TimeoutError') return true;
    const code = 'code' in current ? current.code : undefined;
    if (
      typeof code === 'string' &&
      (CONNECTION_CODES.has(code) || TLS_CODE.test(code))
    )
      return true;
    current = current.cause;
  }
  return false;
}

/** The pair of backends of every host, made from the config. */
function endpointPartsOf(cfg: SpawnerConfig): EndpointParts[] {
  const entries = incusOf(cfg).endpoints ?? [];
  return incusEndpointConfigs(cfg).map((view, index) => {
    const runtime = getIncusRuntime(view);
    const incus = incusOf(view);
    const name = endpointLabel(view);
    return {
      name,
      cfg: view,
      drained: entries[index]?.drained ?? false,
      host: new IncusBackend(view, { runtime }),
      session: new IncusSessionBackend(view, { runtime }),
      room: async () => {
        const { client, pool } = await runtime.connect();
        const room = await readProjectRoom(client, incus.storagePool, name);
        const memory = withStandbysFreed(
          room.memory,
          pool.readyCount(),
          incusSizeBytes(poolShape(view).limits.memory) ?? 0,
        );
        return { ...room, ...(memory === undefined ? {} : { memory }) };
      },
      inFlight: () => runtime.inFlight,
      retireStandbys: async () => {
        const report = await (await runtime.connect()).pool.reconcile();
        if (report.removed > 0) {
          console.log(
            `[sandbox.incus] ${name} is drained: removed ${report.removed} warm standby(s)`,
          );
        }
      },
    };
  });
}

/**
 * The hosts, the record of where each session lives, and what is known of
 * each host's state. Shared by the host and the session backend.
 */
export class IncusEndpointSet {
  readonly endpoints: readonly Endpoint[];
  /** Session id → the name of the host it lives on: the durable record, as
   * read at start and kept since. */
  private readonly placement = new Map<string, string>();
  /** Every declared host has been listed once since the record was made. */
  private complete = false;
  /** The declared hosts listed once since the record was made. Kept once
   * the record is complete: a host declared later is not among them, so it
   * is listed before the record counts as complete again. */
  private readonly listed = new Set<string>();
  private readonly store: PlacementStore;
  private loaded: Promise<void> | null = null;
  /** The record's writes, one after the other. */
  private writes: Promise<void> = Promise.resolve();
  private completing: Promise<void> | null = null;
  /** The sessions seen on a host other than their recorded one, as logged
   * (once each, not at every listing). */
  private readonly conflicts = new Set<string>();
  /** Session ids being placed, per host: counted before its listing shows
   * them. */
  private readonly placing = new Map<string, Set<string>>();
  private readonly now: () => number;
  private initTimer: ReturnType<typeof setInterval> | null = null;
  /** Draining or shut down: nothing is retried any more. */
  private stopped = false;
  private imageMissing: ((detail: string) => void) | null = null;

  constructor(parts: readonly EndpointParts[], deps: EndpointSetDeps) {
    if (parts.length === 0) {
      throw new Error('the Incus backend needs at least one endpoint');
    }
    this.endpoints = parts.map((part) => ({
      ...part,
      ready: false,
      imageReady: false,
    }));
    for (const endpoint of this.endpoints) {
      this.placing.set(endpoint.name, new Set());
    }
    this.now = deps.now ?? Date.now;
    this.store = deps.record;
  }

  byName(name: string): Endpoint | undefined {
    return this.endpoints.find((endpoint) => endpoint.name === name);
  }

  /** The host the record names for a session, if any (for tests and logs). */
  placementOf(sessionId: string): string | undefined {
    return this.placement.get(sessionId);
  }

  /** Every host has been listed once since the record was made. */
  get recordComplete(): boolean {
    return this.complete;
  }

  // ---- the durable record --------------------------------------------------

  /** Reads the record once; a spawner without one starts rebuilding it.
   * THROWS when the record can be neither read nor written: the spawner
   * does not serve sessions it cannot keep on their hosts. */
  ensureLoaded(): Promise<void> {
    this.loaded ??= this.loadRecord().catch((error: unknown) => {
      this.loaded = null;
      throw error;
    });
    return this.loaded;
  }

  private async loadRecord(): Promise<void> {
    const record = await this.store.load();
    if (record === undefined) {
      console.log(
        `[sandbox.incus] no placement record yet: it is rebuilt from the listings of ${this.endpoints.map((e) => e.name).join(', ')}; until each has been listed, a session it does not name is refused`,
      );
    } else {
      for (const [sessionId, name] of Object.entries(record.sessions)) {
        this.placement.set(sessionId, name);
      }
      // A host the record has not listed (one declared since, or one
      // declared again after it was removed) may hold sessions made without
      // the record: it is listed before an unnamed session is placed.
      for (const name of record.listed) {
        if (this.byName(name) !== undefined) this.listed.add(name);
      }
      const unlisted = this.endpoints.filter(
        (endpoint) => !this.listed.has(endpoint.name),
      );
      this.complete = unlisted.length === 0;
      if (record.complete && unlisted.length > 0) {
        console.log(
          `[sandbox.incus] the placement record has not listed ${unlisted.map((e) => e.name).join(', ')}: until it has, a session it does not name is refused`,
        );
      }
      const gone = [...new Set(this.placement.values())].filter(
        (name) => this.byName(name) === undefined,
      );
      if (gone.length > 0) {
        console.warn(
          `[sandbox.incus] the placement record names sessions on ${gone.join(', ')}, which is no longer declared: those sessions are refused until it is again`,
        );
      }
    }
    // Written at once: a record that cannot be written fails the boot, not
    // the first create.
    await this.persist();
  }

  private snapshot(): PlacementRecord {
    return {
      complete: this.complete,
      listed: [...this.listed].sort(),
      sessions: Object.fromEntries(
        [...this.placement].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    };
  }

  /** Writes the record as it is now, after the writes before it. */
  private persist(): Promise<void> {
    const next = this.writes.then(() => this.store.save(this.snapshot()));
    this.writes = next.catch(() => undefined);
    return next;
  }

  /** persist(), with a failure logged rather than thrown: the record keeps
   * an entry it no longer needs, or misses one a listing adds again. */
  private async persistOrWarn(what: string): Promise<void> {
    try {
      await this.persist();
    } catch (error) {
      console.warn(
        `[sandbox.incus] the placement record could not be written after ${what}:`,
        message(error),
      );
    }
  }

  /** A session seen on a host: recorded there unless the record already
   * names a host for it, which it keeps (the session is resumed only
   * there). True when the record changed. */
  private observe(sessionId: string, endpoint: Endpoint): boolean {
    const recorded = this.placement.get(sessionId);
    if (recorded === endpoint.name) return false;
    if (recorded !== undefined) {
      const conflict = `${sessionId} ${endpoint.name}`;
      if (!this.conflicts.has(conflict)) {
        this.conflicts.add(conflict);
        console.warn(
          `[sandbox.incus] session ${sessionId} is recorded on ${recorded} and is also seen on ${endpoint.name}; it stays on ${recorded}`,
        );
      }
      return false;
    }
    this.placement.set(sessionId, endpoint.name);
    return true;
  }

  /** Sessions seen on a host, recorded and written when any is new. */
  async observeAll(
    endpoint: Endpoint,
    sessionIds: Iterable<string>,
  ): Promise<void> {
    let changed = false;
    for (const sessionId of sessionIds) {
      if (this.observe(sessionId, endpoint)) changed = true;
    }
    if (changed) await this.persistOrWarn(`a listing of ${endpoint.name}`);
  }

  /** A session's workspace is gone from its host: the record lets go. */
  async forget(sessionId: string, endpoint: Endpoint): Promise<void> {
    if (this.placement.get(sessionId) !== endpoint.name) return;
    this.placement.delete(sessionId);
    await this.persistOrWarn(`${sessionId} ended`);
  }

  /** The hosts not yet listed while the record is being rebuilt. */
  private pendingHosts(): Endpoint[] {
    return this.complete
      ? []
      : this.endpoints.filter((endpoint) => !this.listed.has(endpoint.name));
  }

  /**
   * Rebuilds the record from the hosts not listed yet: each one's sessions
   * and workspaces are recorded where they are. Once every host has been
   * listed, the record is complete. A host that does not answer is tried
   * again on the next call.
   */
  completeRecord(): Promise<void> {
    this.completing ??= this.listPending().finally(() => {
      this.completing = null;
    });
    return this.completing;
  }

  private async listPending(): Promise<void> {
    await this.ensureLoaded();
    const pending = this.pendingHosts().filter(
      (endpoint) => this.backingOff(endpoint) === undefined,
    );
    if (pending.length === 0) return;
    const results = await Promise.allSettled(
      pending.map(async (endpoint) => {
        const [sessions, workspaces] = await Promise.all([
          this.ask(endpoint, 'the session listing', () =>
            endpoint.session.listSessions(),
          ),
          this.ask(endpoint, 'the workspace listing', () =>
            endpoint.session.listWorkspaces(),
          ),
        ]);
        endpoint.lastSessions = sessions;
        for (const { sessionId } of [...sessions, ...workspaces]) {
          this.observe(sessionId, endpoint);
        }
        this.listed.add(endpoint.name);
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[sandbox.incus] ${pending[index]?.name} could not be listed for the placement record; it is tried again:`,
          message(result.reason),
        );
      }
    });
    if (this.pendingHosts().length === 0) {
      this.complete = true;
      console.log(
        `[sandbox.incus] the placement record is complete: ${this.placement.size} session(s) on their hosts`,
      );
    }
    await this.persistOrWarn('listing hosts for the placement record');
  }

  // ---- reachability ------------------------------------------------------

  /** Why the host is not asked now, while it is left alone after a failure. */
  backingOff(endpoint: Endpoint): string | undefined {
    if (endpoint.failedAtMs === undefined) return undefined;
    if (this.now() - endpoint.failedAtMs >= UNREACHABLE_RETRY_MS) {
      return undefined;
    }
    return `unreachable: ${endpoint.failure ?? 'no answer'}`;
  }

  private answered(endpoint: Endpoint, what: string): void {
    if (endpoint.failedAtMs === undefined) return;
    console.log(`[sandbox.incus] ${endpoint.name} answers again (${what})`);
    endpoint.failedAtMs = undefined;
    endpoint.failure = undefined;
  }

  /** A read of the host, each of its Incus requests bounded by its own
   * timeout (the client's, SANDBOX_INCUS_API_TIMEOUT_MS). A failure to
   * connect, or a request with no answer, marks the host unreachable for
   * UNREACHABLE_RETRY_MS; any other failure is the host's answer, and is
   * thrown without the mark, as an answer clears it. */
  async ask<T>(
    endpoint: Endpoint,
    what: string,
    read: () => Promise<T>,
  ): Promise<T> {
    const backoff = this.backingOff(endpoint);
    if (backoff !== undefined) throw new Error(`${endpoint.name} ${backoff}`);
    try {
      const value = await read();
      this.answered(endpoint, what);
      return value;
    } catch (error) {
      const reason = message(error);
      if (!isConnectionFailure(error)) {
        this.answered(endpoint, what);
        console.warn(
          `[sandbox.incus] ${endpoint.name} answered ${what} with a failure: ${reason}`,
        );
        throw error;
      }
      if (endpoint.failedAtMs === undefined || endpoint.failure !== reason) {
        console.warn(
          `[sandbox.incus] ${endpoint.name} did not answer ${what}; it is skipped for ${UNREACHABLE_RETRY_MS / 1000} s: ${reason}`,
        );
      }
      endpoint.failedAtMs = this.now();
      endpoint.failure = reason;
      throw error;
    }
  }

  // ---- boot --------------------------------------------------------------

  /** Boots one host: its checks, its pool, and its image once it is up. */
  async initEndpoint(endpoint: Endpoint): Promise<void> {
    try {
      await endpoint.host.init();
    } catch (error) {
      const reason = message(error);
      if (endpoint.initError !== reason) {
        console.error(
          `[sandbox.incus] ${endpoint.name} takes no session until it passes its boot checks (asked again every ${INIT_RETRY_MS / 1000} s): ${reason}`,
        );
      }
      endpoint.initError = reason;
      throw error;
    }
    if (endpoint.initError !== undefined) {
      console.log(`[sandbox.incus] ${endpoint.name} passed its boot checks`);
    }
    endpoint.ready = true;
    endpoint.initError = undefined;
    if (endpoint.drained && endpoint.retireStandbys !== undefined) {
      await endpoint.retireStandbys().catch((error: unknown) => {
        console.warn(
          `[sandbox.incus] removing the warm standbys of drained ${endpoint.name} failed:`,
          message(error),
        );
      });
    }
  }

  /** Every host at once. Fatal only when none passes: a spawner with one
   * host it can use serves, and checks the others again on a timer. */
  async init(): Promise<void> {
    await this.ensureLoaded();
    const results = await Promise.allSettled(
      this.endpoints.map((endpoint) => this.initEndpoint(endpoint)),
    );
    const failed = results.flatMap((result, index) =>
      result.status === 'rejected' ? [this.endpoints[index]] : [],
    );
    if (failed.length === this.endpoints.length) {
      throw new Error(
        `no Incus endpoint passed its boot checks:\n${this.endpoints
          .map((endpoint) => `- ${endpoint.name}: ${endpoint.initError}`)
          .join('\n')}`,
      );
    }
    const usable = this.endpoints.filter((e) => e.ready && !e.drained);
    console.log(
      `[sandbox.incus] ${this.endpoints.length} endpoints: ${this.endpoints
        .map(
          (e) =>
            `${e.name} (${e.ready ? (e.drained ? 'drained' : `cap ${e.cfg.session.maxSessions}`) : 'failed its boot checks'})`,
        )
        .join(', ')}; ${usable.length} take new sessions`,
    );
    if (failed.length > 0) this.scheduleInitRetry();
    await this.completeRecord();
  }

  /** Checks again, on a timer, each host that failed its boot checks or
   * whose runtime image could not be made present, until none is left. Not
   * once the spawner drains: a late host's warm pool is its replacement's. */
  private scheduleInitRetry(): void {
    if (this.initTimer !== null || this.stopped) return;
    this.initTimer = setInterval(() => {
      const pending = this.endpoints.filter(
        (endpoint) => !endpoint.ready || !endpoint.imageReady,
      );
      if (pending.length === 0) {
        this.stopInitRetry();
        return;
      }
      for (const endpoint of pending) {
        const booted = endpoint.ready
          ? Promise.resolve()
          : this.initEndpoint(endpoint);
        booted.then(
          () => this.warmEndpoint(endpoint),
          // initEndpoint logged the reason when it changed.
          () => undefined,
        );
      }
    }, INIT_RETRY_MS);
    this.initTimer.unref?.();
  }

  /** No more retries: the spawner drains or shuts down. */
  stopInitRetry(): void {
    this.stopped = true;
    if (this.initTimer !== null) clearInterval(this.initTimer);
    this.initTimer = null;
  }

  /** The runtime image on one host; false when it could not be made present
   * (and it is tried again on the retry timer). */
  async warmEndpoint(endpoint: Endpoint): Promise<boolean> {
    try {
      await endpoint.host.warmImage();
      endpoint.imageReady = true;
      return true;
    } catch (error) {
      endpoint.imageReady = false;
      console.warn(
        `[sandbox.incus] the runtime image is not ready on ${endpoint.name}; it takes no new session until it is (tried again every ${INIT_RETRY_MS / 1000} s):`,
        message(error),
      );
      this.scheduleInitRetry();
      return false;
    }
  }

  onImageMissing(listener: (detail: string) => void): void {
    this.imageMissing = listener;
  }

  /** A create found the image gone on one host: it takes no new session until
   * the warm-up the listener starts has it back. */
  imageGone(endpoint: Endpoint, detail: string): void {
    endpoint.imageReady = false;
    this.imageMissing?.(`${endpoint.name}: ${detail}`);
  }

  // ---- where a session lives ----------------------------------------------

  /** Does the host hold the session's workspace or instance? */
  private holds(endpoint: Endpoint, sessionId: string): Promise<boolean> {
    return this.ask(endpoint, `whether it holds ${sessionId}`, () =>
      endpoint.session.hasWorkspace(sessionId),
    );
  }

  /**
   * The host that holds the session. A session the record names lives on
   * that host and nowhere else: `unknown` while the host does not answer or
   * is no longer declared, `none` when it answers that it holds neither the
   * workspace nor the instance. A session the record does not name is new
   * (`none`), once every host has been listed for the record; until then a
   * host not yet listed may hold it (`unknown`).
   */
  async home(sessionId: string): Promise<Home> {
    await this.ensureLoaded();
    const recorded = this.placement.get(sessionId);
    if (recorded !== undefined) return this.recordedHome(sessionId, recorded);
    if (!this.complete) {
      await this.completeRecord();
      const found = this.placement.get(sessionId);
      if (found !== undefined) return this.recordedHome(sessionId, found);
      const pending = this.pendingHosts().map((endpoint) => endpoint.name);
      if (pending.length > 0) {
        return {
          unknown: pending,
          recorded: false,
          why: `session ${sessionId} may live on ${pending.join(', ')}, which has not been listed since the placement record was started`,
        };
      }
    }
    return { none: true };
  }

  private async recordedHome(sessionId: string, name: string): Promise<Home> {
    const endpoint = this.byName(name);
    if (endpoint === undefined) {
      return {
        unknown: [name],
        recorded: true,
        why: `session ${sessionId} lives on ${name}, which is no longer declared`,
      };
    }
    try {
      if (await this.holds(endpoint, sessionId)) return { endpoint };
    } catch (error) {
      console.warn(
        `[sandbox.incus] cannot tell whether ${name} still holds ${sessionId}:`,
        message(error),
      );
      return {
        unknown: [name],
        recorded: true,
        why: `session ${sessionId} lives on ${name}, which does not answer: ${message(error)}`,
      };
    }
    // Neither its workspace nor its instance is left there. The entry stays
    // until the session's end is reported (a create in flight may be about
    // to make the workspace); a new create records the host it is placed on.
    return { none: true };
  }

  // ---- placing a new session ----------------------------------------------

  private need(endpoint: Endpoint, spec: SessionSpec): PlacementNeed {
    const shape = sessionShape(endpoint.cfg, spec.profile, spec.docker);
    return {
      memoryBytes: incusSizeBytes(shape.limits.memory) ?? 0,
      diskBytes: incusSizeBytes(incusOf(endpoint.cfg).workspaceSize) ?? 0,
    };
  }

  /** Reads one host's room: its sessions, and its project's memory and disk. */
  private async readRoom(endpoint: Endpoint): Promise<{
    listed: ReadonlySet<string>;
    memory?: Room;
    disk?: Room;
  }> {
    const [sessions, room] = await Promise.all([
      this.listOne(endpoint),
      this.ask(endpoint, 'the room of its project', endpoint.room),
    ]);
    return {
      listed: new Set(
        sessions.filter((s) => s.ended !== true).map((s) => s.sessionId),
      ),
      ...room,
    };
  }

  /** What the host has room for, counting the creates placed on it since its
   * listing was taken. Synchronous: the caller places right after. */
  private candidate(
    endpoint: Endpoint,
    read: { listed: ReadonlySet<string>; memory?: Room; disk?: Room },
    need: PlacementNeed,
  ): EndpointCandidate {
    const pending = new Set<string>([
      ...endpoint.inFlight(),
      ...(this.placing.get(endpoint.name) ?? []),
    ]);
    let unseen = 0;
    for (const id of pending) if (!read.listed.has(id)) unseen += 1;
    const less = (room: Room | undefined, each: number): Room | undefined =>
      room === undefined
        ? undefined
        : { free: Math.max(0, room.free - unseen * each), limit: room.limit };
    const memory = less(read.memory, need.memoryBytes);
    const disk = less(read.disk, need.diskBytes);
    return {
      name: endpoint.name,
      drained: endpoint.drained,
      room: {
        sessions: read.listed.size + unseen,
        maxSessions: endpoint.cfg.session.maxSessions,
        ...(memory === undefined ? {} : { memory }),
        ...(disk === undefined ? {} : { disk }),
      },
    };
  }

  /** Why the host takes no new session now, before it is asked anything. */
  private unavailable(endpoint: Endpoint): string | undefined {
    if (!endpoint.ready) {
      return `failed its boot checks: ${endpoint.initError ?? 'not checked yet'}`;
    }
    if (!endpoint.imageReady) return 'its runtime image is not ready';
    return this.backingOff(endpoint);
  }

  private noteSkip(endpoint: Endpoint, reason: string | undefined): void {
    if (reason === endpoint.lastSkip) return;
    endpoint.lastSkip = reason;
    if (reason !== undefined) {
      console.warn(
        `[sandbox.incus] ${endpoint.name} is passed over for new sessions: ${reason}`,
      );
    }
  }

  /**
   * The host a new session goes to, held for it until `release`. A session
   * whose workspace is on a host goes back there; any other goes to the host
   * with the most headroom. THROWS SessionPlacementError when none may take
   * it.
   */
  async place(spec: SessionSpec): Promise<Endpoint> {
    const home = await this.home(spec.sessionId);
    if ('endpoint' in home) return this.placeAtHome(home.endpoint, spec);
    if ('unknown' in home) {
      // Its workspace may be on a host that cannot be asked: starting it
      // elsewhere would hand the user an empty one.
      throw new SessionPlacementError('unavailable', home.why);
    }

    const asked = this.endpoints.filter(
      (endpoint) =>
        !endpoint.drained && this.unavailable(endpoint) === undefined,
    );
    const reads = await Promise.allSettled(
      asked.map((endpoint) => this.readRoom(endpoint)),
    );
    // From here to the hold below nothing awaits: each placement sees the
    // ones made before it.
    const readings = new Map(
      asked.map((endpoint, index) => [endpoint, reads[index]]),
    );
    const candidates: EndpointCandidate[] = this.endpoints.map((endpoint) => {
      if (endpoint.drained) {
        return { name: endpoint.name, drained: true };
      }
      const read = readings.get(endpoint);
      if (read === undefined) {
        return {
          name: endpoint.name,
          drained: false,
          unavailable: this.unavailable(endpoint) ?? 'not asked',
        };
      }
      if (read.status === 'rejected') {
        return {
          name: endpoint.name,
          drained: false,
          unavailable: `${isConnectionFailure(read.reason) ? 'unreachable' : 'its room could not be read'}: ${message(read.reason)}`,
        };
      }
      return this.candidate(endpoint, read.value, this.need(endpoint, spec));
    });
    const first = this.endpoints[0];
    const need =
      first === undefined
        ? { memoryBytes: 0, diskBytes: 0 }
        : this.need(first, spec);
    const placement = chooseEndpoint(candidates, need);
    for (const endpoint of this.endpoints) {
      const skipped = placement.skipped.find((s) => s.name === endpoint.name);
      // A drained host is passed over by declaration: said once at boot.
      this.noteSkip(
        endpoint,
        skipped === undefined || skipped.reason === 'drained'
          ? undefined
          : skipped.reason,
      );
    }
    const chosen = this.byName(placement.chosen ?? '');
    if (chosen === undefined) {
      const full = placement.skipped.some((s) => s.full);
      const why = placement.skipped
        .map((s) => `${s.name}: ${s.reason}`)
        .join('; ');
      throw new SessionPlacementError(
        full ? 'full' : 'unavailable',
        `no Incus endpoint can take session ${spec.sessionId} now (${why})`,
      );
    }
    await this.hold(chosen, spec.sessionId);
    return chosen;
  }

  /** A session back on the host that holds its workspace: within that host's
   * cap, drained or not. */
  private async placeAtHome(
    endpoint: Endpoint,
    spec: SessionSpec,
  ): Promise<Endpoint> {
    if (!endpoint.ready) {
      throw new SessionPlacementError(
        'unavailable',
        `session ${spec.sessionId} lives on ${endpoint.name}, which has not passed its boot checks: ${endpoint.initError ?? 'not checked yet'}`,
      );
    }
    let read;
    try {
      read = await this.readRoom(endpoint);
    } catch (error) {
      throw new SessionPlacementError(
        'unavailable',
        `session ${spec.sessionId} lives on ${endpoint.name}, which does not answer: ${message(error)}`,
      );
    }
    const candidate = this.candidate(endpoint, read, this.need(endpoint, spec));
    // A session already counted on its host (a duplicate create) is the
    // create's own business: it answers the duplicate.
    const placement = chooseEndpoint(
      [{ ...candidate, drained: false }],
      this.need(endpoint, spec),
    );
    if (placement.chosen === undefined && !read.listed.has(spec.sessionId)) {
      throw new SessionPlacementError(
        'full',
        `session ${spec.sessionId} lives on ${endpoint.name}, which has no room for it now: ${placement.skipped[0]?.reason ?? 'no room'}`,
      );
    }
    if (endpoint.drained) {
      console.log(
        `[sandbox.incus] ${spec.sessionId} resumes on drained ${endpoint.name}, which holds its workspace`,
      );
    }
    await this.hold(endpoint, spec.sessionId);
    return endpoint;
  }

  /** Counts the session on the host at once (the caller places right after
   * reading the room), and records it there durably before its create may
   * make a workspace. THROWS SessionPlacementError when the record cannot be
   * written: a session the record does not hold could be started elsewhere
   * after a restart. */
  private async hold(endpoint: Endpoint, sessionId: string): Promise<void> {
    this.placing.get(endpoint.name)?.add(sessionId);
    const previous = this.placement.get(sessionId);
    if (previous === endpoint.name) return;
    this.placement.set(sessionId, endpoint.name);
    try {
      await this.persist();
    } catch (error) {
      this.release(endpoint, sessionId);
      if (this.placement.get(sessionId) === endpoint.name) {
        if (previous === undefined) this.placement.delete(sessionId);
        else this.placement.set(sessionId, previous);
      }
      throw new SessionPlacementError(
        'unavailable',
        `session ${sessionId} could not be recorded on ${endpoint.name}: ${message(error)}`,
      );
    }
  }

  release(endpoint: Endpoint, sessionId: string): void {
    this.placing.get(endpoint.name)?.delete(sessionId);
  }

  // ---- listing -------------------------------------------------------------

  /** One host's sessions, read now; recorded as where each lives. */
  async listOne(endpoint: Endpoint): Promise<BackendSession[]> {
    const sessions = await this.ask(endpoint, 'the session listing', () =>
      endpoint.session.listSessions(),
    );
    endpoint.lastSessions = sessions;
    await this.observeAll(
      endpoint,
      sessions.map((session) => session.sessionId),
    );
    return sessions;
  }
}

const sets = new WeakMap<SpawnerConfig, IncusEndpointSet>();

/** The hosts of this spawner config; the same set for every caller. */
export function getIncusEndpointSet(cfg: SpawnerConfig): IncusEndpointSet {
  let set = sets.get(cfg);
  if (set === undefined) {
    const stateDir = incusOf(cfg).stateDir;
    if (stateDir === undefined) {
      throw new Error(
        'several Incus endpoints need SANDBOX_INCUS_STATE_DIR for the placement record',
      );
    }
    set = new IncusEndpointSet(endpointPartsOf(cfg), {
      record: new FilePlacementStore(stateDir),
    });
    sets.set(cfg, set);
  }
  return set;
}

/** The host lifecycle of every host. */
export class MultiIncusBackend implements HostBackend {
  readonly kind = 'incus' as const;

  constructor(private readonly set: IncusEndpointSet) {}

  init(): Promise<void> {
    return this.set.init();
  }

  async shutdown(): Promise<void> {
    this.set.stopInitRetry();
    await Promise.all(
      this.set.endpoints.map((endpoint) =>
        endpoint.host.shutdown().catch((error: unknown) => {
          console.warn(
            `[sandbox.incus] shutdown of ${endpoint.name} failed:`,
            message(error),
          );
        }),
      ),
    );
  }

  beginDrain(): void {
    this.set.stopInitRetry();
    for (const endpoint of this.set.endpoints) endpoint.host.beginDrain?.();
  }

  /** Healthy while one host that passed its boot checks is; the detail names
   * each host. */
  async health(): Promise<HealthResult> {
    const results = await Promise.all(
      this.set.endpoints.map(async (endpoint) => ({
        endpoint,
        result: await endpoint.host.health(),
      })),
    );
    const detail = results
      .map(
        ({ endpoint, result }) =>
          `${endpoint.name}${endpoint.drained ? ' (drained)' : ''}: ${result.ok ? result.detail : `down: ${result.error}`}`,
      )
      .join('; ');
    const ok = results.some(
      ({ endpoint, result }) => result.ok && endpoint.ready,
    );
    return ok ? { ok: true, detail } : { ok: false, error: detail };
  }

  /** The image on every host that passed its boot checks. Throws only when
   * no host has it, so creates wait only while none can take one. */
  async warmImage(): Promise<void> {
    const ready = this.set.endpoints.filter((endpoint) => endpoint.ready);
    const warmed = await Promise.all(
      ready.map((endpoint) => this.set.warmEndpoint(endpoint)),
    );
    if (!warmed.some(Boolean)) {
      throw new Error(
        `the runtime image is ready on no Incus endpoint (${ready.length} passed their boot checks)`,
      );
    }
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    const ready = this.set.endpoints.filter((endpoint) => endpoint.ready);
    const swept = await Promise.allSettled(
      ready.map((endpoint) => endpoint.host.sweepOrphans(opts)),
    );
    let removed = 0;
    swept.forEach((result, index) => {
      if (result.status === 'fulfilled') removed += result.value;
      else
        console.warn(
          `[sandbox.incus] the sweep of ${ready[index]?.name} failed:`,
          message(result.reason),
        );
    });
    return removed;
  }
}

/** The session lifecycle across every host. */
export class MultiIncusSessionBackend implements SessionBackend {
  readonly kind = 'incus' as const;

  constructor(private readonly set: IncusEndpointSet) {
    for (const endpoint of set.endpoints) {
      endpoint.session.onRuntimeImageMissing?.((detail) =>
        set.imageGone(endpoint, detail),
      );
    }
  }

  onRuntimeImageMissing(listener: (detail: string) => void): void {
    this.set.onImageMissing(listener);
  }

  /** The address every host's sessions pin, when they all pin the same one;
   * null when the hosts' proxies differ (each moves only with the
   * configuration, which restarts the spawner). */
  async egressAddress(): Promise<string | null> {
    const addresses = new Set(
      await Promise.all(
        this.set.endpoints.map(
          async (endpoint) =>
            (await endpoint.session.egressAddress?.()) ?? null,
        ),
      ),
    );
    const [only] = addresses;
    return addresses.size === 1 ? (only ?? null) : null;
  }

  async createSession(spec: SessionSpec): Promise<CreateSessionResult> {
    const endpoint = await this.set.place(spec);
    try {
      return await endpoint.session.createSession(spec);
    } catch (error) {
      if (!(error instanceof SessionExistsError)) {
        console.warn(
          `[sandbox.incus] create of ${spec.sessionId} on ${endpoint.name} failed:`,
          message(error),
        );
      }
      throw error;
    } finally {
      this.set.release(endpoint, spec.sessionId);
    }
  }

  /** The host that holds the session, or the answer for a session that no
   * host holds (any host gives it), or a throw while a host that may hold it
   * does not answer. */
  private async route(sessionId: string, what: string) {
    const home = await this.set.home(sessionId);
    if ('endpoint' in home) return home.endpoint;
    if ('unknown' in home) {
      throw new Error(`cannot ${what} ${sessionId}: ${home.why}`);
    }
    const any = this.set.endpoints.find(
      (endpoint) => this.set.backingOff(endpoint) === undefined,
    );
    if (any === undefined) {
      throw new Error(`cannot ${what} ${sessionId}: no endpoint answers`);
    }
    return any;
  }

  async resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string> {
    const endpoint = await this.route(sessionId, 'resolve');
    return endpoint.session.resolveEndpoint(sessionId, expectedCreatedAtMs);
  }

  async sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    const endpoint = await this.route(sessionId, 'look for');
    return endpoint.session.sessionExists(sessionId, expectedCreatedAtMs);
  }

  async hasWorkspace(sessionId: string): Promise<boolean> {
    const home = await this.set.home(sessionId);
    if ('endpoint' in home) return true;
    if ('none' in home) return false;
    throw new Error(
      `cannot tell whether ${sessionId} has a workspace: ${home.why}`,
    );
  }

  async stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
    options?: StopSessionOptions,
  ): Promise<boolean> {
    const endpoint = await this.route(sessionId, 'stop');
    return endpoint.session.stopSession(
      sessionId,
      expectedCreatedAtMs,
      options,
    );
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const endpoint = await this.route(sessionId, 'destroy');
    const destroyed = await endpoint.session.destroySession(sessionId);
    // Its workspace is deleted (a failure throws above): the session may be
    // made again, on any host.
    await this.set.forget(sessionId, endpoint);
    return destroyed;
  }

  /** The host that held the workspace answers; with no record of one, every
   * host does, and `done` needs them all (one that does not answer is
   * `pending`). */
  async workspaceDeletion(
    sessionId: string,
    waitMs?: number,
  ): Promise<WorkspaceDeletion> {
    const known = this.set.byName(this.set.placementOf(sessionId) ?? '');
    const asked = known === undefined ? this.set.endpoints : [known];
    const answers = await Promise.all(
      asked.map((endpoint) =>
        endpoint.session.workspaceDeletion(sessionId, waitMs).then(
          async (answer) => {
            if (answer === 'done') await this.set.forget(sessionId, endpoint);
            return answer;
          },
          (error: unknown): WorkspaceDeletion => {
            console.warn(
              `[sandbox.incus] the deletion of ${sessionId}'s workspace on ${endpoint.name} is unknown:`,
              message(error),
            );
            return 'pending';
          },
        ),
      ),
    );
    for (const answer of ['failed', 'pending', 'handed_off'] as const) {
      if (answers.includes(answer)) return answer;
    }
    return 'done';
  }

  async reapStaleSession(
    sessionId: string,
    expectedCreatedAtMs: number,
  ): Promise<boolean> {
    let endpoint;
    try {
      endpoint = await this.route(sessionId, 'reap');
    } catch (error) {
      // Not provably abandoned while its host cannot be asked.
      console.warn(`[sandbox.incus] ${message(error)}`);
      return false;
    }
    return (
      endpoint.session.reapStaleSession?.(sessionId, expectedCreatedAtMs) ??
      false
    );
  }

  async setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void> {
    const endpoint = await this.route(sessionId, 'pin');
    await endpoint.session.setPinned(sessionId, pinned, expectedCreatedAtMs);
  }

  /**
   * Every host's sessions. A host that does not answer contributes the ones
   * it held when it last did, so its sessions are not taken for ended while
   * it is away; THROWS only when no host answers.
   */
  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    const results = await Promise.allSettled(
      this.set.endpoints.map((endpoint) => this.set.listOne(endpoint)),
    );
    if (results.every((result) => result.status === 'rejected')) {
      const [first] = results;
      throw first?.status === 'rejected'
        ? first.reason
        : new Error('no Incus endpoint answers');
    }
    const seen = new Set<string>();
    const out: BackendSession[] = [];
    results.forEach((result, index) => {
      const endpoint = this.set.endpoints[index];
      const sessions =
        result.status === 'fulfilled'
          ? result.value
          : (endpoint?.lastSessions ?? []);
      for (const session of sessions) {
        if (organizationId && session.organizationId !== organizationId) {
          continue;
        }
        if (seen.has(session.sessionId)) continue;
        seen.add(session.sessionId);
        out.push(session);
      }
    });
    return out;
  }

  /** Every workspace of the hosts that answer: one left out is never
   * destroyed. THROWS only when no host answers. */
  async listWorkspaces(): Promise<BackendWorkspace[]> {
    const results = await Promise.allSettled(
      this.set.endpoints.map((endpoint) =>
        this.set.ask(endpoint, 'the workspace listing', () =>
          endpoint.session.listWorkspaces(),
        ),
      ),
    );
    if (results.every((result) => result.status === 'rejected')) {
      const [first] = results;
      throw first?.status === 'rejected'
        ? first.reason
        : new Error('no Incus endpoint answers');
    }
    const out: BackendWorkspace[] = [];
    for (const [index, result] of results.entries()) {
      const endpoint = this.set.endpoints[index];
      if (result.status !== 'fulfilled' || endpoint === undefined) continue;
      await this.set.observeAll(
        endpoint,
        result.value.map((workspace) => workspace.sessionId),
      );
      out.push(...result.value);
    }
    return out;
  }

  // Nothing per organization beyond the workspaces, on any host.
  async listOrganizationResources(): Promise<string[]> {
    return [];
  }

  async teardownOrganization(): Promise<OrganizationTeardownResult> {
    return { containers: 0, volumes: 0, networks: 0 };
  }

  async reconcileBuildCache(): Promise<void> {}
}
