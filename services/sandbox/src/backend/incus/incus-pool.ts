// The warm pool: standby instances started ahead of time, so that a session's
// handout does not wait for an instance to start (the ~5 s an OCI container
// with a bridged NIC spends on DHCP). It is off at size 0.
//
// A standby is an instance of the pool shape (an agent session of the
// deployment's Docker capability) made from the runtime image and running the
// standby script (incus-standby.ts), which waits for a claim. Claiming one
// labels it as the session, mounts the session's workspace volume and pushes
// the claim file, and the script then boots the session's runnerd in it. What
// is left for the handout is runnerd's own start, not the instance's.
//
// The pool is opportunistic and bounded: the standbys and the sessions
// together never exceed the spawner's session capacity, so a burst of
// sessions takes the capacity back from the pool (makeRoom), and a standby
// that no longer matches what a session would be made of today (a moved proxy,
// a new image) or has stood too long is replaced.

import type { SpawnerConfig } from '../../types.ts';
import { INCUS_STATUS, incusStatus, type IncusInstance } from './incus-api.ts';
import type { IncusClient } from './incus-client.ts';
import {
  incusPoolInstanceName,
  isPoolInstance,
  isSessionInstance,
  label,
  LABEL,
} from './incus-naming.ts';
import {
  buildClaim,
  buildPoolInstance,
  incusOf,
  poolFingerprint,
  poolShape,
  type SessionInstanceInput,
  type SessionShape,
} from './incus-session-spec.ts';
import {
  STANDBY_CLAIM_FILE,
  STANDBY_READY_FILE,
  STANDBY_SCRIPT_PATH,
  standbyScript,
} from './incus-standby.ts';

/** How often the pool looks at itself. */
const RECONCILE_INTERVAL_MS = 30_000;
/** Standbys made at once. */
const MAX_PARALLEL_CREATES = 4;
/** A standby is replaced after this, so the pool follows the image. */
const STANDBY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** A standby that is not waiting for a claim by then is stuck. */
const STANDBY_STARTUP_MS = 90_000;
const OPERATION_WAIT_MS = 120_000;

export interface PoolDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Hex for a standby's name. */
  randomId?: () => string;
  /** Session ids whose create is under way on this spawner, which the
   * instance listing may not show yet. */
  inFlight?: () => ReadonlySet<string>;
}

export interface PoolReport {
  created: number;
  removed: number;
  ready: number;
}

export class IncusPool {
  private readonly shape: SessionShape;
  private readonly size: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly randomId: () => string;
  private readonly inFlight: () => ReadonlySet<string>;
  /** Standbys known to be waiting for a claim, by when they got there. */
  private readonly ready = new Map<string, number>();
  private readonly making = new Set<string>();
  private readonly claiming = new Set<string>();
  private reconciling: Promise<PoolReport> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly client: IncusClient,
    deps: PoolDeps = {},
  ) {
    this.shape = poolShape(cfg);
    this.size = incusOf(cfg).poolSize;
    this.now = deps.now ?? Date.now;
    this.sleep =
      deps.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.randomId =
      deps.randomId ??
      (() => crypto.randomUUID().replaceAll('-', '').slice(0, 12));
    this.inFlight = deps.inFlight ?? (() => new Set());
  }

  /** Begin keeping the pool full; the first pass runs at once, beside boot. */
  start(): void {
    if (this.size === 0 || this.timer !== null) return;
    this.timer = setInterval(
      () => void this.reconcileQuietly(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref?.();
    void this.reconcileQuietly();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  readyCount(): number {
    return this.ready.size;
  }

  private async reconcileQuietly(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      console.warn('[sandbox.incus.pool] reconcile failed:', error);
    }
  }

  /** One pass: drop the standbys that are stale, stuck or surplus, make the
   * missing ones. Passes never overlap; a caller during one joins it. */
  reconcile(): Promise<PoolReport> {
    this.reconciling ??= this.reconcileNow().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  private async currentImage(): Promise<string | undefined> {
    return (await this.client.getImageAlias(incusOf(this.cfg).image))?.target;
  }

  private async reconcileNow(): Promise<PoolReport> {
    const instances = await this.client.listInstances();
    const spawner = this.cfg.instance;
    const standbys = instances.filter((i) => isPoolInstance(i.config, spawner));
    const sessionIds = new Set(
      instances
        .filter((i) => isSessionInstance(i.config, spawner))
        .map((i) => label(i.config, LABEL.session) ?? i.name),
    );
    for (const id of this.inFlight()) sessionIds.add(id);

    for (const name of this.ready.keys()) {
      if (!standbys.some((standby) => standby.name === name)) {
        this.ready.delete(name);
      }
    }

    const fingerprint = poolFingerprint(this.cfg, this.shape);
    const image = await this.currentImage();
    const nowMs = this.now();

    const doomed: IncusInstance[] = [];
    const keep: IncusInstance[] = [];
    for (const standby of standbys) {
      if (this.making.has(standby.name) || this.claiming.has(standby.name)) {
        continue;
      }
      const since = Number(label(standby.config, LABEL.poolSince) ?? 0);
      const age = nowMs - since;
      const dead =
        standby.statusCode === INCUS_STATUS.stopped ||
        standby.statusCode === INCUS_STATUS.error;
      const stale =
        label(standby.config, LABEL.pool) !== fingerprint ||
        (image !== undefined &&
          label(standby.config, LABEL.poolImage) !== image) ||
        age > STANDBY_MAX_AGE_MS;
      if (dead || stale || this.size === 0) {
        doomed.push(standby);
        continue;
      }
      if (!this.ready.has(standby.name)) {
        if (await this.waiting(standby.name))
          this.ready.set(standby.name, nowMs);
        else if (age > STANDBY_STARTUP_MS) {
          doomed.push(standby);
          continue;
        }
      }
      keep.push(standby);
    }

    // Capacity is the spawner's: sessions first, the pool with what is left.
    const room = Math.max(0, this.cfg.session.maxSessions - sessionIds.size);
    const target =
      image === undefined ? keep.length : Math.min(this.size, room);
    const surplus = keep.length - Math.min(target, this.size);
    if (surplus > 0) {
      // Standbys not yet waiting go first, then the oldest.
      keep.sort(
        (a, b) =>
          Number(this.ready.has(a.name)) - Number(this.ready.has(b.name)) ||
          Number(label(a.config, LABEL.poolSince) ?? 0) -
            Number(label(b.config, LABEL.poolSince) ?? 0),
      );
      doomed.push(...keep.splice(0, surplus));
    }

    let removed = 0;
    for (const standby of doomed) {
      if (await this.discard(standby.name)) removed += 1;
    }

    let created = 0;
    if (image !== undefined) {
      let missing =
        Math.min(target, this.size) - keep.length - this.making.size;
      while (missing > 0) {
        const batch = Math.min(missing, MAX_PARALLEL_CREATES);
        const results = await Promise.all(
          Array.from({ length: batch }, () => this.makeStandby(image)),
        );
        created += results.filter(Boolean).length;
        missing -= batch;
        // A batch that made none is not tried again until the next pass.
        if (!results.some(Boolean)) break;
      }
    }
    return { created, removed, ready: this.ready.size };
  }

  /** Is the standby up and waiting for a claim? */
  private async waiting(name: string): Promise<boolean> {
    try {
      return await this.client.fileExists(name, STANDBY_READY_FILE);
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] cannot tell whether ${name} waits:`,
        error,
      );
      return false;
    }
  }

  private async makeStandby(imageFingerprint: string): Promise<boolean> {
    const name = incusPoolInstanceName(this.randomId());
    this.making.add(name);
    try {
      await this.client.createInstance(
        buildPoolInstance(this.cfg, this.shape, {
          name,
          imageFingerprint,
          nowMs: this.now(),
        }),
        OPERATION_WAIT_MS,
      );
      // The script has to be in the rootfs before the instance first runs.
      await this.client.pushFile(name, STANDBY_SCRIPT_PATH, standbyScript(), {
        mode: '0755',
        uid: 0,
        gid: 0,
      });
      await this.client.changeInstanceState(name, 'start', {
        waitMs: OPERATION_WAIT_MS,
      });
      const deadline = this.now() + STANDBY_STARTUP_MS;
      while (!(await this.waiting(name))) {
        if (this.now() > deadline) {
          throw new Error(
            `the standby ${name} never started waiting for a claim`,
          );
        }
        await this.sleep(200);
      }
      this.ready.set(name, this.now());
      return true;
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] making a standby (${name}) failed:`,
        error,
      );
      await this.discard(name);
      return false;
    } finally {
      this.making.delete(name);
    }
  }

  /** Remove a standby (or the debris of one); true when it existed. */
  private async discard(name: string): Promise<boolean> {
    this.ready.delete(name);
    try {
      try {
        await this.client.changeInstanceState(name, 'stop', {
          force: true,
          waitMs: OPERATION_WAIT_MS,
        });
      } catch (error) {
        // Already stopped, or already gone: the delete below settles which.
        const message = error instanceof Error ? error.message : String(error);
        if (
          incusStatus(error) !== 404 &&
          !/already stopped|not running/i.test(message)
        ) {
          console.warn(
            `[sandbox.incus.pool] stopping ${name}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      // An ephemeral instance deletes itself once stopped; give it a moment,
      // then take it out if it is still there.
      for (let i = 0; i < 20; i += 1) {
        if ((await this.client.getInstance(name)) === undefined) return true;
        await this.sleep(100);
        if (i === 4) await this.client.deleteInstance(name, OPERATION_WAIT_MS);
      }
      console.warn(`[sandbox.incus.pool] ${name} is still there after removal`);
      return false;
    } catch (error) {
      console.warn(`[sandbox.incus.pool] removing ${name} failed:`, error);
      return false;
    }
  }

  /**
   * Make the next session out of a waiting standby, or answer undefined when
   * there is none (or the claim failed, in which case the standby is gone and
   * the caller creates the session cold). On success the instance is labelled
   * as the session, holds its workspace and has been told to boot as it.
   */
  async claim(
    input: SessionInstanceInput,
    shape: SessionShape,
  ): Promise<string | undefined> {
    const name = this.takeReady();
    if (name === undefined) return undefined;
    try {
      const found = await this.client.getInstance(name);
      if (
        found === undefined ||
        found.instance.statusCode !== INCUS_STATUS.running ||
        !isPoolInstance(found.instance.config, this.cfg.instance)
      ) {
        throw new Error('the standby is gone or no longer waiting');
      }
      const claim = buildClaim(this.cfg, shape, input);
      // The ETag makes the claim exclusive: a peer that claimed the same
      // standby between the read and this write is refused.
      await this.client.patchInstance(name, claim.patch, {
        ifMatch: found.etag,
      });
      await this.client.pushFile(name, STANDBY_CLAIM_FILE, claim.file, {
        mode: '0600',
        uid: 0,
        gid: 0,
      });
      return name;
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] claiming ${name} for ${input.sessionId} failed; the session starts cold:`,
        error,
      );
      await this.discard(name);
      return undefined;
    } finally {
      this.claiming.delete(name);
      void this.reconcileQuietly();
    }
  }

  private takeReady(): string | undefined {
    for (const name of this.ready.keys()) {
      if (this.claiming.has(name)) continue;
      this.ready.delete(name);
      this.claiming.add(name);
      return name;
    }
    return undefined;
  }

  /** Give capacity back before `extra` more sessions start: standbys beyond
   * what the capacity leaves them are removed. */
  async makeRoom(extra: number): Promise<void> {
    if (this.size === 0 && this.ready.size === 0) return;
    const instances = await this.client.listInstances();
    const spawner = this.cfg.instance;
    const sessions = new Set(
      instances
        .filter((i) => isSessionInstance(i.config, spawner))
        .map((i) => label(i.config, LABEL.session) ?? i.name),
    );
    for (const id of this.inFlight()) sessions.add(id);
    const standbys = instances.filter((i) => isPoolInstance(i.config, spawner));
    const over =
      sessions.size + standbys.length + extra - this.cfg.session.maxSessions;
    if (over <= 0) return;
    // Those not yet waiting go first.
    standbys.sort(
      (a, b) => Number(this.ready.has(a.name)) - Number(this.ready.has(b.name)),
    );
    for (const standby of standbys.slice(0, over)) {
      if (this.claiming.has(standby.name)) continue;
      await this.discard(standby.name);
    }
  }
}
