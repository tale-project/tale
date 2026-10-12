import { describe, expect, it } from 'vitest';

import { NO_FABRICATION, NO_RAW_CONTEXT } from '../chat/assistant';
import { renderWorkLadder, type WorkLoadout } from './ladder';
import { taskAgentFor } from './task-persona';

const LOADOUT: WorkLoadout = {
  createFile: true,
  generateImage: false,
  skills: true,
  runCode: true,
  escalate: true,
};

describe('taskAgentFor', () => {
  it('speaks as the agent: its own instructions lead, then the run, the ladder, the two rules', () => {
    const agent = taskAgentFor({
      agentId: 'agent-1',
      instructions: 'You are the finance agent.',
      loadout: LOADOUT,
    });
    expect(agent.slug).toBe('agent-1');
    const text = agent.instructions;
    const order = [
      'You are the finance agent.',
      '**THIS RUN**',
      renderWorkLadder(LOADOUT) ?? '(no ladder)',
      NO_FABRICATION,
      NO_RAW_CONTEXT,
    ].map((part) => text.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('carries the task language policy between the ladder and the two rules', () => {
    const text = taskAgentFor({
      agentId: 'agent-1',
      instructions: null,
      loadout: LOADOUT,
      language: 'Task language policy: German.',
    }).instructions;
    expect(text.indexOf('Task language policy: German.')).toBeGreaterThan(
      text.indexOf('MAKING THINGS'),
    );
    expect(text.indexOf('Task language policy: German.')).toBeLessThan(
      text.indexOf(NO_FABRICATION),
    );
  });

  it('works without instructions of its own, and without a ladder when no work tool is offered', () => {
    const agent = taskAgentFor({
      agentId: 'agent-1',
      instructions: null,
      loadout: {
        createFile: false,
        generateImage: false,
        skills: false,
        runCode: false,
      },
    });
    expect(agent.instructions.startsWith('**THIS RUN**')).toBe(true);
    expect(agent.instructions).not.toContain('MAKING THINGS');
  });

  it('is the same text for the same agent and loadout, whatever the task', () => {
    const args = {
      agentId: 'agent-1',
      instructions: '  Be brief.  ',
      loadout: LOADOUT,
    };
    expect(taskAgentFor(args)).toEqual(taskAgentFor({ ...args }));
    expect(taskAgentFor(args).instructions.startsWith('Be brief.\n\n')).toBe(
      true,
    );
  });

  it('offers the full workspace in the ladder only when the run can hand over', () => {
    const withHandover = taskAgentFor({
      agentId: 'a',
      instructions: null,
      loadout: LOADOUT,
    });
    const without = taskAgentFor({
      agentId: 'a',
      instructions: null,
      loadout: { ...LOADOUT, escalate: false },
    });
    expect(withHandover.instructions).toContain('use_workspace');
    expect(without.instructions).not.toContain('use_workspace');
  });
});
