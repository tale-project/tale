import type { ProjectDispatchRole } from '@tale/shared/schemas/project-dispatch';
import { describe, expect, it } from 'vitest';

import {
  dueRoleOccurrences,
  nextRoleOccurrence,
  occurrenceLabel,
  roleOccurrenceFeedback,
  roleOccurrenceId,
} from './dispatch-roles.ts';

const manager: ProjectDispatchRole = {
  key: 'manager-light',
  taskId: 'task-manager',
  agentId: 'agent-manager',
  cron: '0,30 * * * *',
  timezone: 'Europe/Zurich',
  mode: 'light',
  brief: 'Route reviews and answer questions.',
};

const at = (iso: string) => Date.parse(iso);

describe('a standing role starts its agent on each occurrence of its schedule [TASK-R45]', () => {
  it('fires the occurrence that is due, once its minute has come', () => {
    const due = dueRoleOccurrences([manager], {
      handled: new Map(),
      since: at('2026-10-14T11:00:00Z'),
      now: at('2026-10-14T12:00:20Z'),
    });
    expect(due).toHaveLength(1);
    expect(due[0]?.occurrenceAt).toBe(at('2026-10-14T12:00:00Z'));
  });

  it('fires nothing for an occurrence already decided', () => {
    const due = dueRoleOccurrences([manager], {
      handled: new Map([['manager-light', at('2026-10-14T12:00:00Z')]]),
      since: at('2026-10-14T11:00:00Z'),
      now: at('2026-10-14T12:05:00Z'),
    });
    expect(due).toEqual([]);
  });

  it('never fires a burst of what an outage missed, nor an occurrence past its grace', () => {
    const due = dueRoleOccurrences([manager], {
      handled: new Map([['manager-light', at('2026-10-14T08:00:00Z')]]),
      since: at('2026-10-14T07:00:00Z'),
      now: at('2026-10-14T12:20:00Z'),
    });
    expect(due).toEqual([]);
    const late = dueRoleOccurrences([manager], {
      handled: new Map([['manager-light', at('2026-10-14T08:00:00Z')]]),
      since: at('2026-10-14T07:00:00Z'),
      now: at('2026-10-14T12:05:00Z'),
    });
    expect(late.map((occurrence) => occurrence.occurrenceAt)).toEqual([
      at('2026-10-14T12:00:00Z'),
    ]);
  });

  it('starts a role added later from the moment the dispatch was saved', () => {
    const due = dueRoleOccurrences([manager], {
      handled: new Map(),
      since: at('2026-10-14T12:01:00Z'),
      now: at('2026-10-14T12:02:00Z'),
    });
    expect(due).toEqual([]);
  });

  it('skips a role whose schedule does not read', () => {
    expect(
      dueRoleOccurrences([{ ...manager, cron: 'not a cron' }], {
        handled: new Map(),
        since: 0,
        now: at('2026-10-14T12:00:20Z'),
      }),
    ).toEqual([]);
    expect(
      nextRoleOccurrence({ ...manager, cron: 'not a cron' }, Date.now()),
    ).toBeNull();
  });
});

describe('an occurrence is labelled in the schedule’s own zone [TASK-R45]', () => {
  it('names the wall-clock time and the UTC instant', () => {
    expect(occurrenceLabel(manager, at('2026-10-14T12:00:00Z'))).toBe(
      'manager-light 2026-10-14 14:00 Europe/Zurich (2026-10-14T12:00:00.000Z)',
    );
  });

  it('tells apart the two occurrences of the hour the clock repeats', () => {
    const first = occurrenceLabel(manager, at('2026-10-25T00:30:00Z'));
    const second = occurrenceLabel(manager, at('2026-10-25T01:30:00Z'));
    expect(first).toContain('2026-10-25 02:30 Europe/Zurich');
    expect(second).toContain('2026-10-25 02:30 Europe/Zurich');
    expect(first).not.toBe(second);
  });

  it('hands the agent the occurrence, its mode and its brief', () => {
    expect(
      roleOccurrenceFeedback(
        manager,
        occurrenceLabel(manager, at('2026-10-14T12:00:00Z')),
      ),
    ).toBe(
      'Scheduled occurrence: manager-light 2026-10-14 14:00 Europe/Zurich (2026-10-14T12:00:00.000Z). Mode: light.\n\nRoute reviews and answer questions.',
    );
    expect(roleOccurrenceId('manager-light', 42)).toBe('manager-light@42');
  });
});
