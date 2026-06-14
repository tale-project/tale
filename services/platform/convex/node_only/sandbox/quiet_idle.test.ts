// The quiet-idle decision behind mid-turn stdin steering. Pure function — no
// mocks. Each case mirrors a real CLI event sequence the linger loop observes;
// the names map to the scenarios validated by the host dry-run.

import { describe, expect, it } from 'vitest';

import { type QuietIdleInputs, quietIdleDecision } from './quiet_idle';

const QUIET = 5_000;

// A parked, quiet, mid-turn baseline: result not seen, not already idle, and
// the main loop has been silent past the debounce. Each test overrides only
// the inflight/pending shape that distinguishes a posture.
const base: QuietIdleInputs = {
  agentIdle: false,
  agentResultSeen: false,
  pendingTasks: 0,
  inflightToolUses: 0,
  inflightSubAgents: 0,
  inflightWaitTools: 0,
  lastMainActivityAt: 0,
  now: QUIET + 1,
  quietIdleMs: QUIET,
};

describe('quietIdleDecision', () => {
  it('CASE B — in-flight blocking TaskOutput while a workflow runs → waittool', () => {
    // Launch Workflow (task-started), then TaskOutput(block=true) is in flight:
    // one main-level tool, and it is the wait tool. The screenshot bug.
    expect(
      quietIdleDecision({
        ...base,
        pendingTasks: 1,
        inflightToolUses: 1,
        inflightWaitTools: 1,
      }),
    ).toBe('waittool');
  });

  it('CASE A — TaskOutput(block=false) returned, then quiet → background', () => {
    // The wait tool resolved (no longer in flight); a background task is still
    // pending and nothing main-level is outstanding.
    expect(quietIdleDecision({ ...base, pendingTasks: 1 })).toBe('background');
  });

  it('CONTROL — final text then quiet with a pending task → background', () => {
    // The only posture exercised live before this fix. Last main event is text;
    // the decision no longer keys on that, only on "no tool in flight".
    expect(quietIdleDecision({ ...base, pendingTasks: 1 })).toBe('background');
  });

  it('SUBAGENT — main loop awaiting Task sub-agents only → subagent', () => {
    expect(
      quietIdleDecision({
        ...base,
        inflightToolUses: 2,
        inflightSubAgents: 2,
      }),
    ).toBe('subagent');
  });

  it('NEGATIVE — a real foreground tool in flight (e.g. Bash build) → none', () => {
    // One main-level tool in flight that is neither a sub-agent nor a wait
    // read, with an unrelated background task pending. Genuinely busy.
    expect(
      quietIdleDecision({ ...base, pendingTasks: 1, inflightToolUses: 1 }),
    ).toBe('none');
  });

  it('MIXED — a Task and a TaskOutput both in flight → none', () => {
    // inflightToolUses (2) matches neither set alone, so neither wait nor
    // sub-agent posture holds — the main loop is doing more than one thing.
    expect(
      quietIdleDecision({
        ...base,
        pendingTasks: 1,
        inflightToolUses: 2,
        inflightSubAgents: 1,
        inflightWaitTools: 1,
      }),
    ).toBe('none');
  });

  it('waittool requires a pending task (TaskOutput on a settled task → none)', () => {
    expect(
      quietIdleDecision({ ...base, inflightToolUses: 1, inflightWaitTools: 1 }),
    ).toBe('none');
  });

  it('background requires no main-level tool in flight', () => {
    expect(
      quietIdleDecision({ ...base, pendingTasks: 1, inflightToolUses: 1 }),
    ).toBe('none');
  });

  it('not quiet yet → none (debounce not elapsed)', () => {
    expect(
      quietIdleDecision({
        ...base,
        pendingTasks: 1,
        inflightToolUses: 1,
        inflightWaitTools: 1,
        now: QUIET - 1,
      }),
    ).toBe('none');
  });

  it('exactly at the debounce boundary fires', () => {
    expect(quietIdleDecision({ ...base, pendingTasks: 1, now: QUIET })).toBe(
      'background',
    );
  });

  it('already idle → none (nothing to re-decide)', () => {
    expect(
      quietIdleDecision({
        ...base,
        agentIdle: true,
        pendingTasks: 1,
        inflightToolUses: 1,
        inflightWaitTools: 1,
      }),
    ).toBe('none');
  });

  it('result already seen → none (idle handled on the result path)', () => {
    expect(
      quietIdleDecision({
        ...base,
        agentResultSeen: true,
        pendingTasks: 1,
        inflightToolUses: 1,
        inflightWaitTools: 1,
      }),
    ).toBe('none');
  });
});
