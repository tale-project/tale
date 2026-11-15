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
//    there. Where it lives is recorded here when it is made, listed or
//    found; a call for a session the record does not hold asks every host
//    whether it holds the session's workspace or instance. A resume goes back
//    to that host, even a drained one (its session is one the host already
//    holds), within the host's cap.
//  - A host that does not answer is skipped for new sessions, with the
//    reason logged, and not asked again for UNREACHABLE_RETRY_MS. Its
//    sessions are listed as last seen, so a blip does not read as their end;
//    a call for one of them fails, and the caller retries. A host that is
//    down from boot shows no session until it answers.
//  - The Incus objects stay the source of truth: the record is a cache of
//    where each session was last seen, and a restarted spawner rebuilds it
//    from the hosts' listings.
//
// Every per-host check stays where it was: SANDBOX_MAX_SESSIONS is the whole
// spawner's cap, judged by the route layer over the union of the hosts'
// listings; each host's own cap, memory and disk are judged here; each
// project's limits are enforced by Incus itself.

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
  chooseEndpoint,
  type EndpointCandidate,
  type PlacementNeed,
  readProjectRoom,
  type Room,
} from './incus-placement.ts';
import { getIncusRuntime } from './incus-runtime.ts';
import { IncusSessionBackend } from './incus-session-backend.ts';
import { incusOf, sessionShape } from './incus-session-spec.ts';

/** A host that did not answer is left alone this long. */
export const UNREACHABLE_RETRY_MS = 30_000;
/** A host whose boot checks failed, or whose runtime image could not be made
 * present, is tried again this often. */
export const INIT_RETRY_MS = 60_000;

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
      unknown: readonly string[];
      /** The host the session was last seen on is among them. */
      recorded: boolean;
    };

export interface EndpointSetDeps {
  now?: () => number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The pair of backends of every host, made from the config. */
export function endpointPartsOf(cfg: SpawnerConfig): EndpointParts[] {
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
      room: async () =>
        readProjectRoom(
          (await runtime.connect()).client,
          incus.storagePool,
          name,
        ),
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
  /** Session id → the name of the host it was last seen on. */
  private readonly placement = new Map<string, string>();
  /** Session ids being placed, per host: counted before its listing shows
   * them. */
  private readonly placing = new Map<string, Set<string>>();
  private readonly now: () => number;
  private initTimer: ReturnType<typeof setInterval> | null = null;
  /** Draining or shut down: nothing is retried any more. */
  private stopped = false;
  private imageMissing: ((detail: string) => void) | null = null;

  constructor(parts: readonly EndpointParts[], deps: EndpointSetDeps = {}) {
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
  }

  byName(name: string): Endpoint | undefined {
    return this.endpoints.find((endpoint) => endpoint.name === name);
  }

  /** Where a session was last seen, if anywhere (for tests and logs). */
  placementOf(sessionId: string): string | undefined {
    return this.placement.get(sessionId);
  }

  record(sessionId: string, endpoint: Endpoint): void {
    const previous = this.placement.get(sessionId);
    if (previous !== undefined && previous !== endpoint.name) {
      console.warn(
        `[sandbox.incus] session ${sessionId} was on ${previous} and is now seen on ${endpoint.name}`,
      );
    }
    this.placement.set(sessionId, endpoint.name);
  }

  forget(sessionId: string, endpoint: Endpoint): void {
    if (this.placement.get(sessionId) === endpoint.name) {
      this.placement.delete(sessionId);
    }
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

  /** A read of the host, bounded by its API budget; a failure marks the host
   * unreachable for UNREACHABLE_RETRY_MS, and an answer clears the mark. */
  async ask<T>(
    endpoint: Endpoint,
    what: string,
    read: () => Promise<T>,
  ): Promise<T> {
    const backoff = this.backingOff(endpoint);
    if (backoff !== undefined) throw new Error(`${endpoint.name} ${backoff}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budgetMs = incusOf(endpoint.cfg).apiTimeoutMs;
    try {
      const value = await Promise.race([
        read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`no answer to ${what} within ${budgetMs} ms`)),
            budgetMs,
          );
        }),
      ]);
      if (endpoint.failedAtMs !== undefined) {
        console.log(`[sandbox.incus] ${endpoint.name} answers again (${what})`);
        endpoint.failedAtMs = undefined;
        endpoint.failure = undefined;
      }
      return value;
    } catch (error) {
      const reason = message(error);
      if (endpoint.failedAtMs === undefined || endpoint.failure !== reason) {
        console.warn(
          `[sandbox.incus] ${endpoint.name} did not answer ${what}; it is skipped for ${UNREACHABLE_RETRY_MS / 1000} s: ${reason}`,
        );
      }
      endpoint.failedAtMs = this.now();
      endpoint.failure = reason;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
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
   * The host that holds the session: the one it was last seen on when that
   * host still holds it, else whichever host answers that it does. `none`
   * only when every host answered; `unknown` names the ones that did not.
   */
  async home(sessionId: string): Promise<Home> {
    const hinted = this.byName(this.placement.get(sessionId) ?? '');
    if (hinted !== undefined) {
      try {
        if (await this.holds(hinted, sessionId)) return { endpoint: hinted };
        this.forget(sessionId, hinted);
      } catch (error) {
        console.warn(
          `[sandbox.incus] cannot tell whether ${hinted.name} still holds ${sessionId}:`,
          message(error),
        );
        return { unknown: [hinted.name], recorded: true };
      }
    }
    const asked = this.endpoints.filter((endpoint) => endpoint !== hinted);
    const answers = await Promise.allSettled(
      asked.map((endpoint) => this.holds(endpoint, sessionId)),
    );
    const found: Endpoint[] = [];
    const unknown: string[] = [];
    answers.forEach((answer, index) => {
      const endpoint = asked[index];
      if (endpoint === undefined) return;
      if (answer.status === 'rejected') unknown.push(endpoint.name);
      else if (answer.value) found.push(endpoint);
    });
    const [first, ...others] = found;
    if (first !== undefined) {
      if (others.length > 0) {
        console.warn(
          `[sandbox.incus] session ${sessionId} has a workspace or instance on ${found.map((e) => e.name).join(' and ')}; ${first.name} serves it`,
        );
      }
      this.record(sessionId, first);
      return { endpoint: first };
    }
    return unknown.length > 0 ? { unknown, recorded: false } : { none: true };
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
    if ('unknown' in home && home.recorded) {
      // Its workspace is on a host that does not answer: starting it
      // elsewhere would hand the user an empty one.
      throw new SessionPlacementError(
        'unavailable',
        `session ${spec.sessionId} lives on ${home.unknown.join(', ')}, which does not answer`,
      );
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
          unavailable: `unreachable: ${message(read.reason)}`,
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
    if ('unknown' in home) {
      // A host that did not answer may hold an older workspace of this id;
      // the session starts fresh here, and the log keeps the trace.
      console.warn(
        `[sandbox.incus] placing ${spec.sessionId} on ${chosen.name} without word from ${home.unknown.join(', ')}, which may hold an earlier workspace of it`,
      );
    }
    this.hold(chosen, spec.sessionId);
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
    this.hold(endpoint, spec.sessionId);
    return endpoint;
  }

  private hold(endpoint: Endpoint, sessionId: string): void {
    this.placing.get(endpoint.name)?.add(sessionId);
    // The workspace may exist from here on, whatever the create's outcome.
    this.record(sessionId, endpoint);
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
    for (const session of sessions) this.record(session.sessionId, endpoint);
    return sessions;
  }
}

const sets = new WeakMap<SpawnerConfig, IncusEndpointSet>();

/** The hosts of this spawner config; the same set for every caller. */
export function getIncusEndpointSet(cfg: SpawnerConfig): IncusEndpointSet {
  let set = sets.get(cfg);
  if (set === undefined) {
    set = new IncusEndpointSet(endpointPartsOf(cfg));
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
      throw new Error(
        `cannot ${what} ${sessionId}: ${home.unknown.join(', ')} did not answer, and may hold it`,
      );
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
      `cannot tell whether ${sessionId} has a workspace: ${home.unknown.join(', ')} did not answer`,
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
    return endpoint.session.destroySession(sessionId);
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
          (answer) => {
            if (answer === 'done') this.set.forget(sessionId, endpoint);
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
    results.forEach((result, index) => {
      const endpoint = this.set.endpoints[index];
      if (result.status !== 'fulfilled' || endpoint === undefined) return;
      for (const workspace of result.value) {
        this.set.record(workspace.sessionId, endpoint);
        out.push(workspace);
      }
    });
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
