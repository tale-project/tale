/**
 * The built-in scenario: {@link runVirtualUser} makes one virtual user
 * behave like a person of its persona until the runner stops it.
 *
 * A user lives in sessions. A session authenticates, boots the dashboard,
 * holds the organization's hint stream, then runs journeys with idle
 * pauses between them; after an exponentially distributed while
 * (`sessionSeconds` on average) the person closes the tab and a fresh
 * session of the same person starts. A lapsed session (401) is
 * re-authenticated in place. Nothing here throws: every failure is a
 * metric, and a harness defect is recorded as `scenario` errors.
 */

import type { RunVirtualUser, VirtualUserContext } from './contract.ts';
import type { Journey } from './journeys/journey.ts';
import { releaseRestKey } from './journeys/rest.ts';
import { PERSONAS, nextJourney } from './personas.ts';
import { sleep } from './think.ts';
import { JourneyInterrupted, VirtualUser } from './user.ts';

export { hintRegistry } from './registry.ts';
export { PERSONAS } from './personas.ts';

/** Run one journey; interruptions are expected, anything else is a bug. */
async function runJourney(vu: VirtualUser, journey: Journey): Promise<void> {
  vu.metrics.counter(`journey.${vu.persona}.${journey.name}`);
  const started = performance.now();
  try {
    await journey.run(vu);
    vu.metrics.timing(`journey.${journey.name}`, performance.now() - started);
  } catch (error) {
    if (error instanceof JourneyInterrupted) {
      vu.metrics.counter(`journey.interrupted.${error.reason}`);
      return;
    }
    vu.metrics.error(
      'scenario',
      'journey_failed',
      `${journey.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

async function liveSession(vu: VirtualUser): Promise<void> {
  const endsAt = performance.now() + vu.sessionLengthMs();
  const persona = PERSONAS[vu.persona];
  while (!vu.signal.aborted && performance.now() < endsAt) {
    if (vu.unauthorized && !(await vu.reauthenticate())) return;
    const wait = vu.backoffRemainingMs;
    if (wait > 0) await sleep(wait, vu.signal);
    if (vu.signal.aborted) return;
    await runJourney(vu, nextJourney(vu));
    if (vu.signal.aborted) return;
    try {
      await vu.pause('idle', persona.idleFactor);
    } catch (error) {
      // The pause's guard throws only to end a journey; between journeys
      // the loop's own checks above take over.
      if (!(error instanceof JourneyInterrupted)) throw error;
    }
  }
}

async function live(vu: VirtualUser): Promise<void> {
  // Spread a ramp's arrivals over a few seconds, as people do not all
  // click in the same millisecond.
  await sleep(
    vu.random() * 3_000 * Math.min(1, vu.options.thinkTimeScale),
    vu.signal,
  );
  let failedStarts = 0;
  while (!vu.signal.aborted) {
    let started = false;
    try {
      started = await vu.startSession();
    } catch (error) {
      vu.metrics.error(
        'scenario',
        'session_start_failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
    if (!started) {
      vu.closeStreams();
      failedStarts += 1;
      const ceiling = Math.min(60_000, 2_000 * 2 ** Math.min(failedStarts, 5));
      await sleep(
        Math.max(vu.backoffRemainingMs, ceiling * (0.5 + vu.random() / 2)),
        vu.signal,
      );
      continue;
    }
    failedStarts = 0;
    await liveSession(vu);
    await vu.endSession();
    // The time between closing the tab and coming back.
    if (!vu.signal.aborted)
      await sleep(vu.random() * 10_000 * vu.options.thinkTimeScale, vu.signal);
  }
}

/** The scenario's entry point (the contract in `contract.ts`). */
export const runVirtualUser: RunVirtualUser = async (
  ctx: VirtualUserContext,
): Promise<void> => {
  let vu: VirtualUser | null = null;
  try {
    vu = new VirtualUser(ctx);
    await live(vu);
  } catch (error) {
    ctx.metrics.error(
      'scenario',
      'user_failed',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    if (vu !== null) {
      vu.closeStreams();
      try {
        await releaseRestKey(vu);
      } catch (error) {
        ctx.metrics.error('scenario', 'release_failed', String(error));
      }
    }
  }
};
