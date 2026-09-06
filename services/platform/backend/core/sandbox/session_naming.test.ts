import { describe, it, expect } from 'vitest';

import {
  sessionIdForRender,
  sessionIdForWorkflowExecution,
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
