/**
 * The virtual users of ONE process: started and stopped to follow a target
 * count, each on its own abort signal.
 *
 * Users come from a fixed index range (this process's slice of the plan).
 * A user index is never run twice at once — it is one person, with one
 * session token — so the pool can hold at most as many users as its range
 * has indexes. Ramping down stops the most recently started users first,
 * the way a crowd thins out at the end of a day.
 */

import type { Agent } from 'undici/index.js';

import type { MetricsRegistry } from '../metrics/index.ts';
import type { LoadPlan } from '../plan.ts';
import type {
  PersonaWeights,
  RunVirtualUser,
  ScenarioOptions,
} from '../scenario/contract.ts';
import { PERSONA_NAMES } from '../scenario/contract.ts';
import {
  benchmarkAddress,
  mulberry32,
  personaFor,
  userSeed,
} from './assign.ts';
import type { PersonaAssignment } from './profiles.ts';

export interface PoolOptions {
  plan: LoadPlan;
  /** Half-open range of user indexes this pool may run. */
  range: { start: number; end: number };
  /** Entry points of the deployment; users are spread across them. */
  baseUrls: readonly string[];
  /** One agent per source address; users are spread across them. */
  agents: readonly Agent[];
  metrics: MetricsRegistry;
  authSecret: string | null;
  personas: PersonaWeights;
  personaAssignment: PersonaAssignment;
  scenario: ScenarioOptions;
  /** Send a per-user benchmark address as X-Forwarded-For. */
  forwardedFor: boolean;
  seed: number;
  runUser: RunVirtualUser;
}

interface ActiveUser {
  index: number;
  controller: AbortController;
  done: Promise<void>;
}

export class UserPool {
  readonly #options: PoolOptions;
  /** Started order: the last entry is the newest user. Entries of users
   * that already ended are skipped lazily, so ending a user costs O(1). */
  readonly #stack: ActiveUser[] = [];
  /** Users started and not yet asked to stop. */
  readonly #live = new Set<ActiveUser>();
  /** Indexes whose user has not finished winding down. */
  readonly #running = new Set<number>();
  /** Every started user's completion, until it has wound down. */
  readonly #winding = new Map<number, Promise<void>>();
  #cursor: number;
  #target = 0;

  constructor(options: PoolOptions) {
    if (options.range.end <= options.range.start) {
      throw new Error('a pool needs a non-empty user range');
    }
    if (options.baseUrls.length === 0) {
      throw new Error('a pool needs at least one base URL');
    }
    if (options.agents.length === 0) {
      throw new Error('a pool needs at least one agent');
    }
    this.#options = options;
    this.#cursor = options.range.start;
  }

  /** Users this pool can hold at most: one per index of its range. */
  get capacity(): number {
    return this.#options.range.end - this.#options.range.start;
  }

  get active(): number {
    return this.#live.size;
  }

  get target(): number {
    return this.#target;
  }

  /**
   * Follow a new target: start or stop users until the count matches. A
   * user still winding down keeps its index, so a pool asked to grow right
   * after shrinking may have no index free: it starts what it can now and
   * the rest on a later call.
   */
  setTarget(target: number): void {
    this.#target = Math.max(0, Math.min(Math.floor(target), this.capacity));
    while (this.#live.size < this.#target) {
      if (!this.#start()) break;
    }
    while (this.#live.size > this.#target) this.#stopNewest();
  }

  /**
   * Stop every user and wait (at most `timeoutMs`) for all of them to wind
   * down — those just stopped and those a falling target stopped earlier.
   */
  async stopAll(timeoutMs = 30_000): Promise<number> {
    this.#target = 0;
    while (this.#live.size > 0) this.#stopNewest();
    const done = [...this.#winding.values()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.allSettled(done).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return timedOut ? this.#running.size : 0;
  }

  /** A free index of the range, or null while every one is still running. */
  #nextIndex(): number | null {
    const { start, end } = this.#options.range;
    for (let tries = 0; tries < end - start; tries += 1) {
      const index = this.#cursor;
      this.#cursor = this.#cursor + 1 >= end ? start : this.#cursor + 1;
      if (!this.#running.has(index)) return index;
    }
    return null;
  }

  /** Start one user; false when no index is free. */
  #start(): boolean {
    const options = this.#options;
    const index = this.#nextIndex();
    if (index === null) return false;
    const controller = new AbortController();
    const baseUrl =
      options.baseUrls[index % options.baseUrls.length] ??
      options.baseUrls[0] ??
      '';
    const agent =
      options.agents[index % options.agents.length] ?? options.agents[0];
    if (agent === undefined) throw new Error('a pool needs at least one agent');
    this.#running.add(index);
    options.metrics.gauge('users.active', 1);
    const user: ActiveUser = {
      index,
      controller,
      done: Promise.resolve(),
    };
    user.done = options
      .runUser({
        index,
        plan: options.plan,
        baseUrl,
        agent,
        metrics: options.metrics,
        authSecret: options.authSecret,
        persona:
          options.personaAssignment === 'round-robin'
            ? (PERSONA_NAMES[index % PERSONA_NAMES.length] ?? 'browser')
            : personaFor(options.personas, options.seed, index),
        random: mulberry32(userSeed(options.seed, index)),
        options: options.scenario,
        signal: controller.signal,
        forwardedFor: options.forwardedFor ? benchmarkAddress(index) : null,
      })
      .catch((error: unknown) => {
        // The contract says a user never throws; one that does is a harness
        // defect, counted so a run cannot hide it.
        options.metrics.error('user', 'crashed', String(error));
        console.error(`[load] virtual user ${index} crashed:`, error);
      })
      .finally(() => {
        this.#running.delete(index);
        this.#winding.delete(index);
        this.#live.delete(user);
        options.metrics.gauge('users.active', -1);
      });
    this.#winding.set(index, user.done);
    this.#stack.push(user);
    this.#live.add(user);
    return true;
  }

  #stopNewest(): void {
    for (;;) {
      const user = this.#stack.pop();
      if (user === undefined) return;
      if (!this.#live.delete(user)) continue;
      user.controller.abort();
      return;
    }
  }
}
