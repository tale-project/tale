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
// a new image, another standby script) or has stood too long is replaced.
//
// A claim and a removal can meet on one standby (a create admitted before a
// drain, a replacement spawner clearing stale standbys). Both write the
// instance under the ETag they read it with, and Incus lets only the first
// through: a removal marks the standby retired before it deletes it, and a
// claim that finds the mark, or loses the write, passes that standby over.

import { outsideOperationBudget } from '../../operation-budget.ts';
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
import { removeIncusInstance } from './incus-remove.ts';
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
/** Standbys a claim passes over (gone, retired, changed by another) before
 * the session starts cold. */
const MAX_CLAIM_ATTEMPTS = 3;

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
  private stopped = false;

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
    this.stopped = false;
    this.timer = setInterval(
      () => void this.reconcileQuietly(),
      RECONCILE_INTERVAL_MS,
    );
    this.timer.unref?.();
    void this.reconcileQuietly();
  }

  /**
   * Stop keeping the pool: the timer ends, a pass under way winds down at its
   * next step, and a claim no longer refills. The standbys stay, for whichever
   * spawner keeps the pool next. A draining spawner stops its pool: its
   * replacement keeps one, and two spawners each filling the pool to its
   * target would pass the session capacity between them.
   */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  readyCount(): number {
    return this.ready.size;
  }

  /** The pass the pool runs by itself: on a timer, at boot and behind a claim.
   * It is the pool's own work, never bound to the create it follows from (the
   * claim runs inside that create's budget, and its abort would otherwise
   * cancel the refill). */
  private async reconcileQuietly(): Promise<void> {
    try {
      await outsideOperationBudget(() => this.reconcile());
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

  private report(created: number, removed: number): PoolReport {
    return { created, removed, ready: this.ready.size };
  }

  private async reconcileNow(): Promise<PoolReport> {
    if (this.stopped) return this.report(0, 0);
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
      // A retired standby is what an interrupted removal left.
      const retired = label(standby.config, LABEL.poolRetired) !== undefined;
      if (dead || stale || retired || this.size === 0) {
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
      if (this.stopped) return this.report(0, removed);
      if (await this.retire(standby.name)) removed += 1;
    }

    let created = 0;
    if (image !== undefined) {
      let missing =
        Math.min(target, this.size) - keep.length - this.making.size;
      while (missing > 0 && !this.stopped) {
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
    return this.report(created, removed);
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
        await this.consoleTail(name),
      );
      await this.retire(name);
      return false;
    } finally {
      this.making.delete(name);
    }
  }

  /** What the standby printed last, for the log of a standby that failed: the
   * instance is not ephemeral, so its console outlives the failure until it is
   * removed. Empty when it cannot be read. */
  private async consoleTail(name: string): Promise<string> {
    try {
      const tail = await this.client.getConsoleLog(name, 2_000);
      return tail.trim() === '' ? '' : `\nlast console lines:\n${tail.trim()}`;
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] cannot read the console of ${name}:`,
        error instanceof Error ? error.message : error,
      );
      return '';
    }
  }

  /**
   * Remove a standby (or the debris of one); false when it could not be. The
   * standby is marked retired under the ETag it was read with before anything
   * is stopped, which settles a race with a claim: a claim that read it
   * earlier loses its write, and a standby that was claimed since it was
   * listed is no longer one and is left alone.
   */
  private async retire(name: string): Promise<boolean> {
    this.ready.delete(name);
    try {
      const found = await this.client.getInstance(name);
      if (found === undefined) return true;
      if (!isPoolInstance(found.instance.config, this.cfg.instance)) {
        console.warn(
          `[sandbox.incus.pool] ${name} is no longer a standby (claimed meanwhile); left in place`,
        );
        return false;
      }
      if (label(found.instance.config, LABEL.poolRetired) === undefined) {
        try {
          await this.client.patchInstance(
            name,
            { config: { [LABEL.poolRetired]: '1' } },
            found.etag === undefined ? {} : { ifMatch: found.etag },
          );
        } catch (error) {
          if (incusStatus(error) !== 412) throw error;
          console.warn(
            `[sandbox.incus.pool] ${name} changed since it was read (claimed meanwhile); left in place`,
          );
          return false;
        }
      }
      await removeIncusInstance(this.client, name, {
        sleep: this.sleep,
        createdAt: found.instance.createdAt,
      });
      return true;
    } catch (error) {
      console.warn(`[sandbox.incus.pool] removing ${name} failed:`, error);
      return false;
    }
  }

  /**
   * Make the next session out of a waiting standby, or answer undefined when
   * there is none to claim (the caller then creates the session cold). On
   * success the instance is labelled as the session, holds its workspace and
   * has been told to boot as it.
   *
   * A standby that cannot be claimed (gone, not running, retired, changed by
   * another since it was read) is passed over and the next one tried; it is
   * never removed here, because it is not this claim's to remove. A claim the
   * node refuses for its own reasons (the workspace volume is missing) leaves
   * the standby a standby. Only an instance this claim already turned into the
   * session, whose claim file then could not be pushed, is removed.
   */
  async claim(
    input: SessionInstanceInput,
    shape: SessionShape,
  ): Promise<string | undefined> {
    try {
      for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
        const name = this.takeReady();
        if (name === undefined) return undefined;
        const readySince = this.now();
        try {
          const outcome = await this.claimOne(name, input, shape);
          if (outcome === 'claimed') return name;
          if (outcome === 'refused') {
            // The node refused this claim, not the standby: it still waits.
            this.ready.set(name, readySince);
            return undefined;
          }
          if (outcome === 'abandoned') return undefined;
        } catch (error) {
          console.warn(
            `[sandbox.incus.pool] claiming ${name} for ${input.sessionId} failed; the session starts cold:`,
            error,
          );
          return undefined;
        } finally {
          this.claiming.delete(name);
        }
      }
      return undefined;
    } finally {
      void this.reconcileQuietly();
    }
  }

  /** One standby, one try: `claimed`; `passed` when this standby cannot be
   * claimed and another may be tried; `refused` when the node refused the
   * claim itself, which another standby would meet too, and the standby is as
   * it was; `abandoned` when the claim was written but could not be delivered,
   * and the instance it made a session of was removed. */
  private async claimOne(
    name: string,
    input: SessionInstanceInput,
    shape: SessionShape,
  ): Promise<'claimed' | 'passed' | 'refused' | 'abandoned'> {
    const found = await this.client.getInstance(name);
    if (
      found === undefined ||
      found.instance.statusCode !== INCUS_STATUS.running ||
      !isPoolInstance(found.instance.config, this.cfg.instance) ||
      label(found.instance.config, LABEL.poolRetired) !== undefined
    ) {
      return 'passed';
    }
    const claim = buildClaim(this.cfg, shape, input);
    try {
      // The ETag makes the claim exclusive: a peer that claimed, or a removal
      // that retired, the same standby between the read and this write wins,
      // and this write is refused.
      await this.client.patchInstance(
        name,
        claim.patch,
        found.etag === undefined ? {} : { ifMatch: found.etag },
      );
    } catch (error) {
      if (incusStatus(error) === 412) return 'passed';
      console.warn(
        `[sandbox.incus.pool] the node refused to hand ${name} to ${input.sessionId}; the session starts cold:`,
        error instanceof Error ? error.message : error,
      );
      return 'refused';
    }
    try {
      await this.client.pushFile(name, STANDBY_CLAIM_FILE, claim.file, {
        mode: '0600',
        uid: 0,
        gid: 0,
      });
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] the claim of ${name} for ${input.sessionId} could not be delivered; the session starts cold:`,
        error instanceof Error ? error.message : error,
      );
      await this.abandon(name, input.createAttemptId);
      return 'abandoned';
    }
    return 'claimed';
  }

  /** Remove an instance this claim made the session of, after the rest of the
   * claim failed. Only that: what carries another attempt's label is not ours. */
  private async abandon(name: string, attemptId: string): Promise<void> {
    try {
      const found = await this.client.getInstance(name);
      if (found === undefined) return;
      if (label(found.instance.config, LABEL.createAttempt) !== attemptId) {
        console.warn(
          `[sandbox.incus.pool] ${name} no longer carries this claim's attempt; left in place`,
        );
        return;
      }
      await removeIncusInstance(this.client, name, {
        sleep: this.sleep,
        createdAt: found.instance.createdAt,
      });
    } catch (error) {
      console.warn(
        `[sandbox.incus.pool] removing the failed claim ${name} failed:`,
        error,
      );
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
      await this.retire(standby.name);
    }
  }
}
