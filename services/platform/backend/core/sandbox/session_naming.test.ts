import { describe, it, expect } from 'vitest';

import {
  isProjectAgentSession,
  memberSessionIdForProjectAgent,
  sessionIdForRender,
  sessionIdForWorkflowExecution,
  standingSessionIdForProjectAgent,
  workflowExecutionOwnerId,
} from './session_naming';

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
