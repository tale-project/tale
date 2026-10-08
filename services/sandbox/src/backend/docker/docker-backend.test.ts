import { afterEach, expect, mock, test } from 'bun:test';

import {
  type dockerSweepOrphans,
  LEGACY_SWEEP_INTERVAL_MS,
} from '../../cleanup.ts';
import { loadConfig } from '../../config.ts';
import { DockerBackend } from './docker-backend.ts';

const oldToken = process.env.SANDBOX_TOKEN;
afterEach(() => {
  if (oldToken === undefined) delete process.env.SANDBOX_TOKEN;
  else process.env.SANDBOX_TOKEN = oldToken;
});

const SWEEP = { staleBeforeMs: 0, isLive: () => false };

test('the legacy one-shot sweep runs at the first tick after boot and then hourly; a failed one is retried at the next tick', async () => {
  process.env.SANDBOX_TOKEN = 'docker-backend-test';
  let now = 1_000_000;
  let probeAnswers = true;
  const sweep = mock<typeof dockerSweepOrphans>(
    async (_cfg, _stale, _isLive, options) => ({
      removed: 0,
      legacySwept: options?.legacy === true && probeAnswers,
    }),
  );
  const boot = mock(async () => {});
  const backend = new DockerBackend(loadConfig(), {
    boot,
    sweep,
    now: () => now,
  });
  await backend.init();
  expect(boot).toHaveBeenCalledTimes(1);
  const legacyRuns = () =>
    sweep.mock.calls.map(([, , , options]) => options?.legacy);

  // The boot sweep's listing reads an unanswered daemon as empty, so the
  // first tick lists once more; the five-minute ticks in the hour after it
  // skip the legacy half.
  now += 5 * 60_000;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns()).toEqual([true]);
  for (let tick = 0; tick < 11; tick += 1) {
    now += 5 * 60_000;
    await backend.sweepOrphans(SWEEP);
  }
  expect(legacyRuns()).toEqual([true, ...Array(11).fill(false)]);

  now += 5 * 60_000;
  probeAnswers = false;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
  // Its `docker ps` failed: the next tick tries again.
  now += 5 * 60_000;
  probeAnswers = true;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
  now += LEGACY_SWEEP_INTERVAL_MS - 1;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(false);
  now += 1;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
});
