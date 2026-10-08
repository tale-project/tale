/**
 * Load profiles: the shape of a run over time, and how its users behave.
 *
 * A profile is a list of stages — ramp to a number of concurrent users over
 * some seconds, then hold it — plus overrides of the scenario options and
 * the persona mix. The runner turns the stages into a target user count per
 * second; everything else is the scenario's business.
 *
 * | profile        | question it answers                                        |
 * | -------------- | ---------------------------------------------------------- |
 * | `smoke`        | does every journey work at all, against this deployment?   |
 * | `load`         | does it hold the expected crowd for the whole duration?    |
 * | `stress`       | where does it break? (steps up until a threshold fails)    |
 * | `spike`        | does a sudden crowd recover, or tip it over?               |
 * | `soak`         | does it leak or drift over hours?                          |
 * | `connections`  | how many idle open tabs (live streams) does it hold?       |
 * | `signin-storm` | does a wave of password sign-ins (a Monday morning) hold?  |
 */

import { z } from 'zod';

import {
  PERSONA_NAMES,
  type PersonaWeights,
  type ScenarioOptions,
} from '../scenario/contract.ts';

export const PROFILE_NAMES = [
  'smoke',
  'load',
  'stress',
  'spike',
  'soak',
  'connections',
  'signin-storm',
] as const;

export type ProfileName = (typeof PROFILE_NAMES)[number];

export interface Stage {
  /** Concurrent users at the end of the ramp. */
  users: number;
  /** Seconds to move linearly from the previous stage's users to `users`. */
  rampSeconds: number;
  /** Seconds to hold `users` after the ramp. */
  holdSeconds: number;
}

export interface Profile {
  name: ProfileName;
  stages: Stage[];
  /** Scenario switches this profile sets unless the run overrides them. */
  scenario: Partial<ScenarioOptions>;
  /** Persona mix this profile uses unless the run overrides it. */
  personas: PersonaWeights | null;
  /**
   * Stop at the end of the first stage whose window fails a threshold, and
   * report the last stage that held as the breaking point (stress only).
   */
  stopOnThresholdFailure: boolean;
}

export const profileInputSchema = z.object({
  profile: z.enum(PROFILE_NAMES),
  /** Peak concurrent users. */
  users: z.number().int().min(1),
  /** Seconds to reach the peak. */
  rampSeconds: z.number().min(0).default(120),
  /** Seconds to hold the peak (steps of a stress run each hold this). */
  holdSeconds: z.number().min(1).default(600),
  /** Steps a stress run climbs in. */
  steps: z.number().int().min(1).max(100).default(5),
});

export type ProfileInput = z.input<typeof profileInputSchema>;

const EVERY_PERSONA_ONCE: PersonaWeights = Object.fromEntries(
  PERSONA_NAMES.map((name) => [name, 1]),
) as PersonaWeights;

/** Build the stages and defaults of a profile from the run's sizing. */
export function buildProfile(raw: ProfileInput): Profile {
  const input = profileInputSchema.parse(raw);
  const { users, rampSeconds, holdSeconds } = input;
  switch (input.profile) {
    case 'smoke': {
      // Few users, every persona, fast think times: proves each journey
      // end to end in a couple of minutes.
      return {
        name: 'smoke',
        stages: [
          {
            users: Math.min(users, PERSONA_NAMES.length * 2),
            rampSeconds: Math.min(rampSeconds, 10),
            holdSeconds: Math.min(holdSeconds, 120),
          },
        ],
        scenario: { thinkTimeScale: 0.1, sessionSeconds: 0 },
        personas: EVERY_PERSONA_ONCE,
        stopOnThresholdFailure: false,
      };
    }
    case 'load': {
      return {
        name: 'load',
        stages: [
          { users, rampSeconds, holdSeconds },
          { users: 0, rampSeconds: Math.min(rampSeconds, 60), holdSeconds: 1 },
        ],
        scenario: {},
        personas: null,
        stopOnThresholdFailure: false,
      };
    }
    case 'stress': {
      const stages: Stage[] = [];
      for (let step = 1; step <= input.steps; step += 1) {
        stages.push({
          users: Math.round((users * step) / input.steps),
          rampSeconds: rampSeconds / input.steps,
          holdSeconds,
        });
      }
      return {
        name: 'stress',
        stages,
        scenario: {},
        personas: null,
        stopOnThresholdFailure: true,
      };
    }
    case 'spike': {
      const base = Math.max(1, Math.round(users / 10));
      return {
        name: 'spike',
        stages: [
          {
            users: base,
            rampSeconds: Math.min(rampSeconds, 60),
            holdSeconds: 60,
          },
          { users, rampSeconds: 5, holdSeconds },
          { users: base, rampSeconds: 5, holdSeconds: 120 },
        ],
        scenario: {},
        personas: null,
        stopOnThresholdFailure: false,
      };
    }
    case 'soak': {
      return {
        name: 'soak',
        stages: [
          { users, rampSeconds, holdSeconds: Math.max(holdSeconds, 3_600) },
        ],
        scenario: {},
        personas: null,
        stopOnThresholdFailure: false,
      };
    }
    case 'connections': {
      // Idle open tabs: the hint stream held, a thread on screen, hardly a
      // click. Measures what the live connections alone cost.
      return {
        name: 'connections',
        stages: [{ users, rampSeconds, holdSeconds }],
        scenario: {
          chat: false,
          uploads: false,
          knowledgeSearch: false,
          thinkTimeScale: 20,
          sessionSeconds: 0,
        },
        personas: { browser: 1 },
        stopOnThresholdFailure: false,
      };
    }
    case 'signin-storm': {
      // Everyone signs in with the password inside the ramp, then reads.
      return {
        name: 'signin-storm',
        stages: [
          { users, rampSeconds, holdSeconds: Math.min(holdSeconds, 120) },
        ],
        scenario: {
          passwordSignInRate: 1,
          chat: false,
          uploads: false,
          sessionSeconds: 0,
        },
        personas: { browser: 1 },
        stopOnThresholdFailure: false,
      };
    }
  }
}

/** Total seconds a profile runs. */
export function profileSeconds(profile: Profile): number {
  return profile.stages.reduce(
    (sum, stage) => sum + stage.rampSeconds + stage.holdSeconds,
    0,
  );
}

/**
 * The target number of concurrent users `elapsedSeconds` into the run, and
 * the stage index it falls in (`stages.length` once the run is over).
 */
export function targetAt(
  profile: Profile,
  elapsedSeconds: number,
): { users: number; stage: number } {
  let from = 0;
  let at = 0;
  for (let index = 0; index < profile.stages.length; index += 1) {
    const stage = profile.stages[index];
    if (stage === undefined) break;
    const rampEnd = at + stage.rampSeconds;
    if (elapsedSeconds < rampEnd) {
      const progress =
        stage.rampSeconds === 0 ? 1 : (elapsedSeconds - at) / stage.rampSeconds;
      return {
        users: Math.round(from + (stage.users - from) * progress),
        stage: index,
      };
    }
    const holdEnd = rampEnd + stage.holdSeconds;
    if (elapsedSeconds < holdEnd) return { users: stage.users, stage: index };
    from = stage.users;
    at = holdEnd;
  }
  return { users: 0, stage: profile.stages.length };
}
