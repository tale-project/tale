import { describe, expect, it } from 'vitest';

import { renderTaskHandover, type TaskHandover } from './handover';

const LABELS: TaskHandover['labels'] = {
  createTask: 'Create task',
  createAndStart: 'Create and start agent',
  assignee: 'Assignee',
  createAgent: 'Create an agent…',
  standardAgent: 'Standard agent',
};

function handover(overrides: Partial<TaskHandover> = {}): TaskHandover {
  return {
    projectsWithAgents: ['Website relaunch'],
    projectsWithoutAgents: 1,
    canAddAgents: false,
    automationOff: false,
    standardAgent: false,
    labels: LABELS,
    ...overrides,
  };
}

describe('renderTaskHandover', () => {
  it('walks a person with an agent project through the three steps, in their labels', () => {
    const note = renderTaskHandover(handover());

    expect(note).toContain('choose "Create task"');
    expect(note).toContain('Pick a project with an agent: Website relaunch.');
    expect(note).toContain('Choose "Create and start agent".');
    expect(note).toContain('quote the control names exactly');
  });

  it('names at most five projects and counts the rest', () => {
    const note = renderTaskHandover(
      handover({
        projectsWithAgents: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      }),
    );

    expect(note).toContain('A, B, C, D, E (and 2 more)');
    expect(note).not.toContain('F');
  });

  it('tells an editor without an agent project how to add one in the task', () => {
    const note = renderTaskHandover(
      handover({ projectsWithAgents: [], canAddAgents: true }),
    );

    expect(note).toContain(
      'under "Assignee" in the task, choose "Create an agent…"',
    );
  });

  it('tells a reader without an agent project who adds agents, not how', () => {
    const note = renderTaskHandover(handover({ projectsWithAgents: [] }));

    expect(note).toContain('an Editor or Admin adds agents');
    expect(note).not.toContain('Create an agent…');
  });

  it('sends work in a project without agents to the standard agent, by its label', () => {
    const note = renderTaskHandover(
      handover({ standardAgent: true, projectsWithoutAgents: 2 }),
    );

    expect(note).toContain(
      'Website relaunch already have agents; in any other project the organization\'s standard agent ("Standard agent") is assigned to the task.',
    );
    expect(note).not.toContain('an Editor or Admin adds agents');
  });

  it('names the standard agent when no project has an agent of its own', () => {
    const note = renderTaskHandover(
      handover({ standardAgent: true, projectsWithAgents: [] }),
    );

    expect(note).toContain(
      'No project they can open has an agent yet, so the organization\'s standard agent ("Standard agent") is assigned to the task.',
    );
    expect(note).not.toContain('Create an agent…');
  });

  it('says agents cannot start while task automation is off', () => {
    const note = renderTaskHandover(handover({ automationOff: true }));

    expect(note).toContain('Agents cannot be started in this workspace');
    expect(note).not.toContain('"Create and start agent"');
  });

  it('tells a person who can open no project who sets one up, instead of steps', () => {
    const note = renderTaskHandover(
      handover({ projectsWithAgents: [], projectsWithoutAgents: 0 }),
    );

    expect(note).toContain('They can open no project yet');
    expect(note).toContain('an Editor or Admin creates a project');
    expect(note).not.toContain('"Create task"');
  });
});
