// The kick-time resume decision table — every row of the plan's matrix, plus
// the binds-check edges (incarnation stamp, op-fallback rows, handle shape).
// Pure-function tests: the convex-test halves (kick/wake actually carrying
// `resume` into the scheduled start) live in task_agent_runs.test.ts.

import { describe, expect, it } from 'vitest';

import {
  isValidResumeHandle,
  resolveTaskKickResume,
  type KickResumePrevious,
} from './task_kick_resume';

const HANDLE = 'c2a38047-3e04-4874-b87a-6a38f56d5041';

const kick = {
  agentId: 'agent-1',
  harness: 'claude-code',
  sessionId: 'pa-agent-1-abc',
  liveSessionCreatedAt: 1_000,
};

function previous(
  overrides: Partial<KickResumePrevious> = {},
): KickResumePrevious {
  return {
    status: 'failed',
    agentId: 'agent-1',
    harness: 'claude-code',
    sessionId: 'pa-agent-1-abc',
    startedAt: 5_000,
    agentSessionId: HANDLE,
    sessionCreatedAt: 1_000,
    ...overrides,
  };
}

describe('resolveTaskKickResume', () => {
  it('first start: no resume, sweep the (empty) box, plain brief', () => {
    expect(resolveTaskKickResume({ previous: null, kick })).toEqual({
      sweep: true,
      inspectNote: false,
    });
  });

  it('failed predecessor with a bound handle resumes and keeps the box', () => {
    expect(resolveTaskKickResume({ previous: previous(), kick })).toEqual({
      resume: HANDLE,
      sessionCreatedAt: 1_000,
      sweep: false,
      inspectNote: true,
    });
  });

  it('cancelled predecessor binds exactly like a failed one', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ status: 'cancelled' }),
        kick,
      }),
    ).toEqual({
      resume: HANDLE,
      sessionCreatedAt: 1_000,
      sweep: false,
      inspectNote: true,
    });
  });

  it('settled predecessor resumes; its fresh fallback sweeps harvested leftovers', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ status: 'settled' }),
        kick,
      }),
    ).toEqual({
      resume: HANDLE,
      sessionCreatedAt: 1_000,
      sweep: true,
      inspectNote: false,
    });
  });

  it('failed predecessor with NO handle: fresh, keep the box (only copy), inspect note', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ agentSessionId: undefined }),
        kick,
      }),
    ).toEqual({ sweep: false, inspectNote: true });
  });

  it('settled predecessor with NO handle: fresh, sweep (leftovers already harvested)', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ status: 'settled', agentSessionId: undefined }),
        kick,
      }),
    ).toEqual({ sweep: true, inspectNote: false });
  });

  it.each([
    ['agent', { agentId: 'agent-2' }],
    ['session', { sessionId: 'pa-other' }],
  ] as const)(
    'a cross-%s predecessor says nothing about THIS session — first-start shape',
    (_dim, override) => {
      expect(
        resolveTaskKickResume({ previous: previous(override), kick }),
      ).toEqual({ sweep: true, inspectNote: false });
    },
  );

  it('a harness edit keeps the session: never binds, fresh per its status', () => {
    expect(
      resolveTaskKickResume({ previous: previous({ harness: 'codex' }), kick }),
    ).toEqual({ sweep: false, inspectNote: true });
    expect(
      resolveTaskKickResume({
        previous: previous({ harness: 'codex', status: 'settled' }),
        kick,
      }),
    ).toEqual({ sweep: true, inspectNote: false });
  });

  it('no live session row: nothing to resume into — fresh', () => {
    expect(
      resolveTaskKickResume({
        previous: previous(),
        kick: { ...kick, liveSessionCreatedAt: undefined },
      }),
    ).toEqual({ sweep: false, inspectNote: true });
  });

  it('destroy-and-recreate (stamp ≠ live createdAt) drops the handle', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ sessionCreatedAt: 900 }),
        kick,
      }),
    ).toEqual({ sweep: false, inspectNote: true });
  });

  it('op-fallback row (no stamp) binds when the live incarnation predates the run', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ sessionCreatedAt: undefined, startedAt: 5_000 }),
        kick: { ...kick, liveSessionCreatedAt: 1_000 },
      }),
    ).toEqual({
      resume: HANDLE,
      sessionCreatedAt: 1_000,
      sweep: false,
      inspectNote: true,
    });
  });

  it('op-fallback row against a RECREATED incarnation (createdAt > startedAt) is fresh', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ sessionCreatedAt: undefined, startedAt: 5_000 }),
        kick: { ...kick, liveSessionCreatedAt: 9_000 },
      }),
    ).toEqual({ sweep: false, inspectNote: true });
  });

  it('a malformed handle (forged CLI output) never reaches an argv — fresh', () => {
    expect(
      resolveTaskKickResume({
        previous: previous({ agentSessionId: '--resume-injection attempt' }),
        kick,
      }),
    ).toEqual({ sweep: false, inspectNote: true });
  });
});

describe('isValidResumeHandle', () => {
  it('accepts the harness id shapes in the wild', () => {
    expect(isValidResumeHandle(HANDLE)).toBe(true); // claude-code UUID
    expect(isValidResumeHandle('ses_8f2k1x9q0p')).toBe(true); // opencode-style
    expect(isValidResumeHandle('0199c2b6.4242')).toBe(true);
  });

  it('rejects anything that could misparse as a flag or carry structure', () => {
    expect(isValidResumeHandle('-rf')).toBe(false);
    expect(isValidResumeHandle('--resume x')).toBe(false);
    expect(isValidResumeHandle('a b')).toBe(false);
    expect(isValidResumeHandle('short')).toBe(false);
    expect(isValidResumeHandle('')).toBe(false);
    expect(isValidResumeHandle(`x${'y'.repeat(200)}`)).toBe(false);
    expect(isValidResumeHandle('päth/../x1')).toBe(false);
  });
});
