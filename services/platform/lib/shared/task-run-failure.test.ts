import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import {
  TASK_RUN_FAILURE_CLASSES,
  taskRunFailureClass,
} from './task-run-failure';

describe('taskRunFailureClass', () => {
  it.each([
    ['budget_exceeded', 'budget'],
    ['agent_deleted', 'setup'],
    ['agent_model_missing', 'setup'],
    ['equipment_missing', 'setup'],
    ['input_missing', 'input'],
    ['deadline', 'time_limit'],
    ['park_deadline', 'capacity'],
    ['harness_error', 'model'],
    ['model_capacity', 'model'],
    ['empty_turn', 'model'],
    ['credential_rotated', 'model'],
    ['credential_cooldown', 'model'],
    ['start_failed', 'start'],
    ['session_gone', 'interrupted'],
    ['turn_crashed', 'interrupted'],
    ['harvest_failed', 'interrupted'],
    ['steer_restart_failed', 'interrupted'],
  ])('reads %s as %s', (code, failureClass) => {
    expect(taskRunFailureClass(code)).toBe(failureClass);
  });

  it('reads no code, and a code this build does not know, as unknown', () => {
    expect(taskRunFailureClass(null)).toBe('unknown');
    expect(taskRunFailureClass(undefined)).toBe('unknown');
    expect(taskRunFailureClass('')).toBe('unknown');
    expect(taskRunFailureClass('a-code-from-a-newer-build')).toBe('unknown');
    // Not a code: an inherited property name must not pass for one.
    expect(taskRunFailureClass('toString')).toBe('unknown');
  });
});

describe('every failure class has its sentence', () => {
  it.each([
    ['en', enMessages],
    ['de', deMessages],
    ['fr', frMessages],
  ])('in %s', (_locale, messages) => {
    const sentences = messages.tasks.agentRun.failure as Record<
      string,
      unknown
    >;
    expect(Object.keys(sentences).toSorted()).toEqual(
      [...TASK_RUN_FAILURE_CLASSES].toSorted(),
    );
    for (const failureClass of TASK_RUN_FAILURE_CLASSES) {
      expect(typeof sentences[failureClass]).toBe('string');
    }
  });
});
