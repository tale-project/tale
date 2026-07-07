import { describe, it, expect } from 'vitest';

import {
  sessionIdForThread,
  sessionIdForUser,
  userOwnerId,
  sessionIdForWorkflowExecution,
  sessionIdForWorkflowRun,
  resolveWorkflowSandboxSession,
} from './session_naming';

// Mirrors the spawner's sessionId validator (services/sandbox/src/wire.ts).
const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const ORG_A = 'jn7ejbems4cty2ezz8b2q1bkw587ya8x';
const ORG_B = 't97e0fj6mwsq1zje9frwmqww2d88e18q';
const USER = 'k976qkykh9t3fs79syk2kn3dwh87z2f0';

describe('sessionIdForUser', () => {
  it('produces an ID_ALPHABET_RE-safe, ≤64-char id', () => {
    const id = sessionIdForUser(ORG_A, USER);
    expect(id).toMatch(ID_ALPHABET_RE);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith('usr-')).toBe(true);
  });

  it('is deterministic for the same (org, user)', () => {
    expect(sessionIdForUser(ORG_A, USER)).toBe(sessionIdForUser(ORG_A, USER));
  });

  it('isolates the same user across organizations', () => {
    // The crux of per-org isolation: same user, different org → different
    // sandbox session id (so org-A workspace is never reachable from org B).
    expect(sessionIdForUser(ORG_A, USER)).not.toBe(
      sessionIdForUser(ORG_B, USER),
    );
  });

  it('differs per user within an org', () => {
    expect(sessionIdForUser(ORG_A, USER)).not.toBe(
      sessionIdForUser(ORG_A, 't9752tpqgg8xp2warj9pvyrv6d88f6zh'),
    );
  });
});

describe('userOwnerId', () => {
  it('composes (org, user) and is org-scoped', () => {
    expect(userOwnerId(ORG_A, USER)).toBe(`${ORG_A}:${USER}`);
    expect(userOwnerId(ORG_A, USER)).not.toBe(userOwnerId(ORG_B, USER));
  });
});

describe('sessionIdForThread', () => {
  it('is the thr- fallback form and id-safe', () => {
    const id = sessionIdForThread('m5788x3q38cfm45j5rx2zqdtq188e2e8');
    expect(id).toMatch(ID_ALPHABET_RE);
    expect(id.startsWith('thr-')).toBe(true);
  });
});

describe('workflow-scoped sandbox sessions', () => {
  const EXEC = 'm5788x3q38cfm45j5rx2zqdtq188e2e8';

  it('sessionIdForWorkflowExecution is stable and distinct from step ids', () => {
    const wf = sessionIdForWorkflowExecution(EXEC);
    const step = sessionIdForWorkflowRun(EXEC, 'advise');
    expect(wf).toMatch(ID_ALPHABET_RE);
    expect(wf).not.toBe(step);
    expect(sessionIdForWorkflowExecution(EXEC)).toBe(
      sessionIdForWorkflowExecution(EXEC),
    );
  });

  it('never collides with a step literally named "workflow"', () => {
    const resolved = resolveWorkflowSandboxSession({
      executionId: EXEC,
      stepSlug: 'workflow',
      sessionScope: 'step',
    });
    expect(resolved.sessionId).not.toBe(sessionIdForWorkflowExecution(EXEC));
    expect(resolved.ownerId).not.toBe(`${EXEC}:@workflow`);
  });

  it('resolveWorkflowSandboxSession maps workflow scope to shared owner', () => {
    const resolved = resolveWorkflowSandboxSession({
      executionId: EXEC,
      stepSlug: 'grade',
      sessionScope: 'workflow',
    });
    expect(resolved.ownerId).toBe(`${EXEC}:@workflow`);
    expect(resolved.checkpointKey).toContain('::grade');
    expect(resolved.sessionScope).toBe('workflow');
  });
});
