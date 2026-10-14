// A session backend over the fake Incus, on a virtual clock, for the tests of
// the Incus backends. Not used by production code.

import { deriveRunnerdToken } from '../../session/session-naming.ts';
import type { IncusConfig, SpawnerConfig } from '../../types.ts';
import type { SessionSpec } from '../types.ts';
import { FakeIncus, FakeRunnerd } from './fake-incus.ts';
import { IncusRuntime } from './incus-runtime.ts';
import { IncusSessionBackend } from './incus-session-backend.ts';
import { incusTestConfig } from './incus-test-config.ts';

export const START_MS = 1_700_000_000_000;

export interface SessionFixtureOptions {
  incus?: Partial<IncusConfig>;
  overrides?: Partial<SpawnerConfig>;
  /** `SANDBOX_MAX_SESSIONS`. */
  maxSessions?: number;
  /** Runs at every sleep of the backend, which is where a test makes
   * something happen while the backend waits. */
  onSleep?: (ms: number) => void;
}

export function sessionFixture(options: SessionFixtureOptions = {}) {
  const fake = new FakeIncus();
  const runnerd = new FakeRunnerd(fake);
  const base = incusTestConfig(options.incus, options.overrides);
  const cfg: SpawnerConfig = {
    ...base,
    session: {
      ...base.session,
      maxSessions: options.maxSessions ?? base.session.maxSessions,
    },
  };
  // Sleeping moves the clock and costs no time.
  const clock = { now: START_MS };
  let attempts = 0;
  let standbys = 0;
  const runtime = new IncusRuntime(cfg, {
    client: fake.client(),
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
      options.onSleep?.(ms);
    },
    randomId: () => `s${(standbys++).toString(16).padStart(4, '0')}`,
    attemptId: () => `attempt-${++attempts}`,
  });
  const backend = new IncusSessionBackend(cfg, {
    runtime,
    runnerdHealth: runnerd.health,
    runnerdEnvPatch: runnerd.envPatch,
  });
  /** A second spawner process over the same Incus (a restart). */
  const restart = () =>
    new IncusSessionBackend(cfg, {
      runtime: new IncusRuntime(cfg, {
        client: fake.client(),
        now: () => clock.now,
        sleep: async (ms) => {
          clock.now += ms;
        },
        attemptId: () => `attempt-restarted-${++attempts}`,
      }),
      runnerdHealth: runnerd.health,
      runnerdEnvPatch: runnerd.envPatch,
    });
  return { fake, runnerd, cfg, clock, runtime, backend, restart };
}

export type SessionFixture = ReturnType<typeof sessionFixture>;

export function specOf(
  sessionId: string,
  overrides: Partial<SessionSpec> = {},
): SessionSpec {
  return {
    sessionId,
    organizationId: 'org_one',
    profile: 'agent',
    ttlMs: 3_600_000,
    idleTimeoutMs: 600_000,
    env: {},
    createdAtMs: START_MS,
    ...overrides,
  };
}

/** The runnerd token the backend derives for a session of the test config. */
export function tokenOf(cfg: SpawnerConfig, sessionId: string): string {
  return deriveRunnerdToken(cfg.sandboxToken, sessionId);
}
