import { describe, expect, it } from 'vitest';

import {
  resolveTaskKickResume,
  type KickResumePrevious,
} from './task_kick_resume';

const SESSION_CREATED_AT = 1_700_000_000_000;

function failedPrevious(
  overrides?: Partial<KickResumePrevious>,
): KickResumePrevious {
  return {
    status: 'failed',
    agentId: 'agent-1',
    harness: 'claude-code',
    sessionId: 'pa-agent-1',
    startedAt: SESSION_CREATED_AT + 60_000,
    agentSessionId: 'conv-abc-123',
    sessionCreatedAt: SESSION_CREATED_AT,
    ...overrides,
  };
}

const kick = {
  agentId: 'agent-1',
  harness: 'claude-code',
  sessionId: 'pa-agent-1',
  liveSessionCreatedAt: SESSION_CREATED_AT,
  resumable: true,
};

describe('resolveTaskKickResume — a harness that never resumes', () => {
  // Gemini CLI: `capabilities.resume: false` in its YAML — its `--resume`
  // replays every tool result twice and the model refuses the conversation.
  const geminiKick = { ...kick, harness: 'gemini', resumable: false };

  it('a settled predecessor starts FRESH, box swept, no handle', () => {
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ status: 'settled', harness: 'gemini' }),
      kick: geminiKick,
    });
    expect(plan).toEqual({ sweep: true, inspectNote: false });
  });

  it('a failed predecessor starts FRESH and keeps the box for inspection', () => {
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ harness: 'gemini' }),
      kick: geminiKick,
    });
    expect(plan).toEqual({ sweep: false, inspectNote: true });
  });

  it('a first start on such a harness is a plain first start', () => {
    const plan = resolveTaskKickResume({ previous: null, kick: geminiKick });
    expect(plan).toEqual({ sweep: true, inspectNote: false });
  });
});

describe('resolveTaskKickResume — provider-rejected conversations', () => {
  it('a failed predecessor without a provider status resumes its conversation', () => {
    const plan = resolveTaskKickResume({ previous: failedPrevious(), kick });
    expect(plan.resume).toBe('conv-abc-123');
    // Failed shape: the box may hold the only copy of unpublished work.
    expect(plan.sweep).toBe(false);
  });

  it('a 404-rejected predecessor starts FRESH on the preserved files', () => {
    // The transcript itself is what the provider refuses (e.g. an image
    // block in a text-only model's conversation) — a --resume retry dies on
    // the same wall in seconds, so the retry must shed the conversation.
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ apiErrorStatus: 404 }),
      kick,
    });
    expect(plan.resume).toBeUndefined();
    expect(plan.sweep).toBe(false);
    expect(plan.inspectNote).toBe(true);
  });

  it('a 400-rejected replay (dropped reasoning_content) also starts FRESH', () => {
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ apiErrorStatus: 400 }),
      kick,
    });
    expect(plan.resume).toBeUndefined();
    expect(plan.inspectNote).toBe(true);
  });

  it('transient provider trouble (429) keeps the conversation continuity', () => {
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ apiErrorStatus: 429 }),
      kick,
    });
    expect(plan.resume).toBe('conv-abc-123');
  });

  it('a SETTLED predecessor with a stray status field still resumes', () => {
    const plan = resolveTaskKickResume({
      previous: failedPrevious({ status: 'settled', apiErrorStatus: 404 }),
      kick,
    });
    expect(plan.resume).toBe('conv-abc-123');
    // Settled shape: leftovers are already on task.outputs.
    expect(plan.sweep).toBe(true);
  });
});
