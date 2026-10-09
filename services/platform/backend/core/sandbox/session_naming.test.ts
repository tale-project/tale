import { describe, it, expect } from 'vitest';

import {
  isProjectAgentSession,
  isStandingProjectAgentSession,
  memberSessionIdForProjectAgent,
  projectAgentWorker,
  sessionIdForRender,
  sessionIdForWorkflowExecution,
  standingSessionIdForProjectAgent,
  workerFamilyBase,
  workerSessionId,
  workflowExecutionOwnerId,
} from './session_naming';
import {
  memberWorkerSessionId,
  standingWorkerSessionId,
} from './session_naming.test-helpers';

// Mirrors the spawner's sessionId validator (services/sandbox/src/wire.ts).
const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;

describe('automation run sandbox sessions', () => {
  const EXEC = 'm5788x3q38cfm45j5rx2zqdtq188e2e8';

  it('sessionIdForWorkflowExecution is stable and spawner-valid', () => {
    const wf = sessionIdForWorkflowExecution(EXEC);
    expect(wf).toMatch(ID_ALPHABET_RE);
    expect(sessionIdForWorkflowExecution(EXEC)).toBe(wf);
    expect(sessionIdForWorkflowExecution(`${EXEC}x`)).not.toBe(wf);
  });

  it('workflowExecutionOwnerId is scoped to the execution', () => {
    expect(workflowExecutionOwnerId(EXEC)).toBe(`${EXEC}:@workflow`);
    expect(workflowExecutionOwnerId(`${EXEC}x`)).not.toBe(
      workflowExecutionOwnerId(EXEC),
    );
  });
});

describe('render sessions', () => {
  it('sessionIdForRender is spawner-valid and distinct per render key', () => {
    const a = sessionIdForRender('batch-a');
    expect(a).toMatch(ID_ALPHABET_RE);
    expect(sessionIdForRender('batch-a')).toBe(a);
    expect(sessionIdForRender('batch-b')).not.toBe(a);
  });
});

describe('project agent sessions', () => {
  it('isProjectAgentSession recognizes every session of the agent and no other', () => {
    for (const agentId of [
      '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
      // Too long to keep verbatim in a member's session id: folded.
      `agent-${'x'.repeat(60)}`,
    ]) {
      const member = memberSessionIdForProjectAgent(agentId, 'user-1');
      expect(member).toMatch(ID_ALPHABET_RE);
      expect(isProjectAgentSession(agentId, member)).toBe(true);
      expect(
        isProjectAgentSession(
          agentId,
          standingSessionIdForProjectAgent(agentId),
        ),
      ).toBe(true);
      expect(isProjectAgentSession(`${agentId}0`, member)).toBe(false);
      expect(isProjectAgentSession(agentId, `${member}0`)).toBe(false);
    }
    // One agent's id prefixing another's never claims its sessions.
    expect(
      isProjectAgentSession(
        'agent-1',
        memberSessionIdForProjectAgent('agent-12', 'user-1'),
      ),
    ).toBe(false);
  });
});

describe('agent worker sessions', () => {
  const AGENT = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';

  it('keeps worker 1 on the family id and suffixes the others', () => {
    const standing = standingSessionIdForProjectAgent(AGENT);
    const member = memberSessionIdForProjectAgent(AGENT, 'user-1');
    expect(standingWorkerSessionId(AGENT, 1)).toBe(standing);
    expect(standingWorkerSessionId(AGENT, 2)).toBe(`${standing}-w2`);
    expect(memberWorkerSessionId(AGENT, 'user-1', 1)).toBe(member);
    expect(memberWorkerSessionId(AGENT, 'user-1', 12)).toBe(`${member}-w12`);
    expect(() => standingWorkerSessionId(AGENT, 0)).toThrow(RangeError);
    expect(() => standingWorkerSessionId(AGENT, 1.5)).toThrow(RangeError);
  });

  it('reads the family and the worker back from every id it derives', () => {
    for (const agentId of [AGENT, `agent-${'x'.repeat(36)}`, 'a'.repeat(58)]) {
      for (const worker of [1, 2, 9, 500, 123456]) {
        const standing = standingWorkerSessionId(agentId, worker);
        const member = memberWorkerSessionId(agentId, 'user-1', worker);
        if (agentId.length + 3 <= 64 || worker > 1) {
          expect(standing.length).toBeLessThanOrEqual(64);
        }
        expect(member).toMatch(ID_ALPHABET_RE);
        expect(projectAgentWorker(agentId, standing)).toEqual({
          scope: 'agent',
          worker,
          base: standingSessionIdForProjectAgent(agentId),
        });
        expect(projectAgentWorker(agentId, member)).toEqual({
          scope: 'member',
          worker,
          base: memberSessionIdForProjectAgent(agentId, 'user-1'),
        });
        expect(isProjectAgentSession(agentId, standing)).toBe(true);
        expect(isProjectAgentSession(agentId, member)).toBe(true);
      }
    }
  });

  it('never takes a member worker for a standing one [SBX-R21]', () => {
    for (const worker of [1, 2, 3]) {
      expect(
        isStandingProjectAgentSession(
          AGENT,
          memberWorkerSessionId(AGENT, 'user-1', worker),
        ),
      ).toBe(false);
      expect(
        isStandingProjectAgentSession(
          AGENT,
          standingWorkerSessionId(AGENT, worker),
        ),
      ).toBe(true);
    }
  });

  it('refuses ids no derivation yields', () => {
    const standing = standingSessionIdForProjectAgent(AGENT);
    const member = memberSessionIdForProjectAgent(AGENT, 'user-1');
    for (const id of [
      `${standing}-w1`,
      `${standing}-w0`,
      `${standing}-w02`,
      `${standing}-wx`,
      `${standing}-w2-w3`,
      `${member}-w1`,
      `${member}0`,
      `${standing}-m${'g'.repeat(16)}`,
      `${standing}-m${'a'.repeat(15)}`,
      standingWorkerSessionId(`${AGENT}0`, 2),
    ]) {
      expect(projectAgentWorker(AGENT, id)).toBeNull();
      expect(isProjectAgentSession(AGENT, id)).toBe(false);
    }
    // Another agent whose id prefixes this one never claims its workers.
    expect(
      projectAgentWorker('agent-1', standingWorkerSessionId('agent-12', 2)),
    ).toBeNull();
  });

  it('folds the agent part when a worker id would not fit', () => {
    const agentId = 'a'.repeat(42);
    const folded = memberWorkerSessionId(agentId, 'user-1', 2);
    expect(folded).toMatch(ID_ALPHABET_RE);
    expect(folded.startsWith(`pa-${agentId}`)).toBe(false);
    const long = 'b'.repeat(60);
    const standing = workerSessionId(long, `pa-${long}`, 3);
    expect(standing).toMatch(ID_ALPHABET_RE);
    expect(standing).not.toContain(long);
    expect(projectAgentWorker(long, standing)?.scope).toBe('agent');
  });

  it('finds the family of every worker, folded ids included', () => {
    const standing = standingSessionIdForProjectAgent(AGENT);
    const member = memberSessionIdForProjectAgent(AGENT, 'user-1');
    expect(workerFamilyBase(AGENT, standingWorkerSessionId(AGENT, 7))).toBe(
      standing,
    );
    expect(workerFamilyBase(AGENT, standing)).toBe(standing);
    expect(
      workerFamilyBase(AGENT, memberWorkerSessionId(AGENT, 'user-1', 2)),
    ).toBe(member);
    const agentId = 'a'.repeat(42);
    expect(
      workerFamilyBase(agentId, memberWorkerSessionId(agentId, 'user-1', 2)),
    ).toBe(memberSessionIdForProjectAgent(agentId, 'user-1'));
    // An id that is none of the agent's workers is its own family.
    expect(workerFamilyBase(AGENT, 'pa-someone-else-w2')).toBe(
      'pa-someone-else-w2',
    );
  });
});
