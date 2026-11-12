// The sandbox runtime image inside the fake Incus, for the tests of the Incus
// backends: what @tale/incus/fake leaves to the image. A standby instance
// only waits, and says so with its ready file; the session boots once a
// complete claim file arrives, with the claim's variables in its
// environment. The runnerd inside each instance is modelled too
// (FakeRunnerd): it boots from the instance's environment, or from the claim
// a standby receives, and answers the readiness poll with the incarnation it
// booted.
//
// Not used by production code.

import {
  FakeIncus,
  type FakeGuest,
  type FakeIncusOptions,
  type FakeInstance,
  instanceEnvironment,
} from '@tale/incus/fake';

import type { RunnerdHealth } from '../../session/runnerd-protocol.ts';
import {
  STANDBY_CLAIM_END,
  STANDBY_CLAIM_FILE,
  STANDBY_READY_FILE,
} from './incus-standby.ts';

/** The spawner's image: a standby waits for its claim, anything else boots
 * at once. */
const SESSION_RUNTIME: FakeGuest = {
  boot(instance, environment) {
    const entrypoint = instance.config['oci.entrypoint'] ?? '';
    if (!entrypoint.includes('standby.sh')) return environment;
    instance.files.set(STANDBY_READY_FILE, { content: '', mode: '' });
    return undefined;
  },
  // The standby script becomes the entrypoint once a complete claim is
  // there: its variables are the environment the session boots with.
  written(instance, path, content) {
    if (path !== STANDBY_CLAIM_FILE) return;
    if (instance.status !== 'Running' || !content.includes(STANDBY_CLAIM_END))
      return;
    const env = instanceEnvironment(instance);
    for (const match of content.matchAll(
      /^export ([A-Z][A-Z0-9_]*)='([^']*)'$/gm,
    )) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) env[key] = value;
    }
    instance.bootEnv = env;
  },
};

/** A fake Incus whose instances run the sandbox runtime image. */
export function fakeSessionIncus(options: FakeIncusOptions = {}): FakeIncus {
  const fake = new FakeIncus(options);
  fake.guest = SESSION_RUNTIME;
  return fake;
}

/**
 * The runnerd of each fake instance, as the backend's readiness poll sees it:
 * it answers only once the instance's main process has booted, only to the
 * token it booted with, and names the incarnation it booted with.
 */
export class FakeRunnerd {
  /** Failing health polls to answer before succeeding. */
  failFirst = 0;
  dockerReady: boolean | undefined;
  /** Env keys runnerd refuses on a seed. */
  denied: string[] = [];
  readonly polls: string[] = [];
  readonly patches: Array<{ baseUrl: string; set: Record<string, string> }> =
    [];
  patchFailure: string | undefined;
  private readonly misses = new Map<string, number>();

  constructor(private readonly incus: FakeIncus) {}

  private instanceAt(baseUrl: string): FakeInstance | undefined {
    return this.incus.instanceByAddress(new URL(baseUrl).hostname);
  }

  readonly health = async (
    opts: { baseUrl: string; token: string },
    signal?: AbortSignal,
  ): Promise<RunnerdHealth> => {
    signal?.throwIfAborted();
    this.polls.push(opts.baseUrl);
    const seen = (this.misses.get(opts.baseUrl) ?? 0) + 1;
    this.misses.set(opts.baseUrl, seen);
    if (seen <= this.failFirst) throw new Error('connection refused');
    const instance = this.instanceAt(opts.baseUrl);
    if (instance?.bootEnv === undefined) throw new Error('connection refused');
    if (instance.bootEnv.TALE_RUNNERD_TOKEN !== opts.token)
      throw new Error('runnerd /healthz 401');
    const incarnation = instance.bootEnv.TALE_RUNNERD_INCARNATION;
    return {
      ok: true,
      ...(this.dockerReady === undefined
        ? {}
        : { dockerReady: this.dockerReady }),
      bootedAtMs: 0,
      ...(incarnation === undefined ? {} : { incarnation }),
      lastActivityAtMs: 0,
      liveExecs: 0,
    };
  };

  readonly envPatch = async (
    opts: { baseUrl: string; token: string },
    patch: { set?: Record<string, string>; unset?: string[] },
    signal?: AbortSignal,
  ): Promise<string[]> => {
    signal?.throwIfAborted();
    if (this.patchFailure !== undefined) throw new Error(this.patchFailure);
    this.patches.push({ baseUrl: opts.baseUrl, set: patch.set ?? {} });
    return this.denied;
  };
}
