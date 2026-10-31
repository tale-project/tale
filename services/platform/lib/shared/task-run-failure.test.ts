import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

import {
  isTaskRunFailureCode,
  TASK_RUN_FAILURE_CLASSES,
  TASK_RUN_FAILURE_CODES,
  taskRunFailureClass,
} from './task-run-failure';

describe('taskRunFailureClass', () => {
  it.each([
    ['budget_exceeded', 'budget'],
    ['policy_refused', 'policy'],
    ['agent_deleted', 'setup'],
    ['agent_model_missing', 'setup'],
    ['equipment_missing', 'setup'],
    ['input_missing', 'input'],
    ['deadline', 'time_limit'],
    ['park_deadline', 'capacity'],
    ['harness_error', 'model'],
    ['model_capacity', 'model_capacity'],
    ['empty_turn', 'model'],
    ['credential_rotated', 'model'],
    ['credential_cooldown', 'model'],
    ['start_failed', 'start'],
    ['session_gone', 'interrupted'],
    ['turn_crashed', 'interrupted'],
    ['turn_stalled', 'stalled'],
    ['harvest_failed', 'interrupted'],
    ['steer_restart_failed', 'interrupted'],
    ['sandbox_capacity', 'interrupted'],
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

describe('the failure codes the backend’s metrics count by [TASK-R86]', () => {
  it('lists every known code once, out of memory among them', () => {
    expect(TASK_RUN_FAILURE_CODES).toContain('resource_exhausted');
    expect(new Set(TASK_RUN_FAILURE_CODES).size).toBe(
      TASK_RUN_FAILURE_CODES.length,
    );
    // Each one has a class of its own: no code falls back to unknown.
    for (const code of TASK_RUN_FAILURE_CODES) {
      expect(isTaskRunFailureCode(code)).toBe(true);
      expect(taskRunFailureClass(code)).not.toBe('unknown');
    }
  });

  it('tells a stored code this build knows from none or a foreign one', () => {
    expect(isTaskRunFailureCode('deadline')).toBe(true);
    expect(isTaskRunFailureCode('teapot_overflow')).toBe(false);
    expect(isTaskRunFailureCode(null)).toBe(false);
    expect(isTaskRunFailureCode(undefined)).toBe(false);
  });
});
