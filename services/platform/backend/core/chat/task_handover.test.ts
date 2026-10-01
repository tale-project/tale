import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { readTaskHandover } from './task_handover';

function ctxAnswering(answer: () => unknown): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the action context
  return {
    runQuery: vi.fn(async () => answer()),
  } as unknown as ActionCtx;
}

const ARGS = { organizationId: 'org-1', userId: 'u-1', locale: 'de' };

describe('readTaskHandover', () => {
  it('builds the note’s facts and labels the controls as the person’s interface does', async () => {
    const handover = await readTaskHandover(
      ctxAnswering(() => ({
        projects: [
          { name: 'Website relaunch', agentCount: 2, canEdit: false },
          { name: 'Getting started', agentCount: 0, canEdit: false },
        ],
        automationEnabled: true,
      })),
      ARGS,
    );

    expect(handover).toEqual({
      projectsWithAgents: ['Website relaunch'],
      projectsWithoutAgents: 1,
      canAddAgents: false,
      automationOff: false,
      labels: {
        createTask: 'Aufgabe erstellen',
        createAndStart: 'Erstellen und Agent starten',
        assignee: 'Zuständig',
        createAgent: 'Agent erstellen …',
      },
    });
  });

  it('knows the person can add an agent only where one is missing', async () => {
    const handover = await readTaskHandover(
      ctxAnswering(() => ({
        projects: [
          { name: 'Has one', agentCount: 1, canEdit: true },
          { name: 'Empty', agentCount: 0, canEdit: false },
        ],
        automationEnabled: false,
      })),
      ARGS,
    );

    expect(handover?.canAddAgents).toBe(false);
    expect(handover?.automationOff).toBe(true);
  });

  it('writes no note for a turn sent with an API key, and reads nothing', async () => {
    const runQuery = vi.fn(async () => ({
      projects: [],
      automationEnabled: true,
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the action context
    const ctx = { runQuery } as unknown as ActionCtx;
    const handover = await readTaskHandover(ctx, {
      ...ARGS,
      apiKeyId: 'key-1',
    });

    expect(handover).toBeUndefined();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('degrades to no note when the read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handover = await readTaskHandover(
      ctxAnswering(() => {
        throw new Error('db down');
      }),
      ARGS,
    );

    expect(handover).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
