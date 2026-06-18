import { describe, expect, it } from 'vitest';

import {
  ACTION_KINDS,
  isActionKind,
  isActionValidOnSource,
} from './action_kinds';
import { evaluateWhen, validateWhen } from './when_predicate';

describe('evaluateWhen', () => {
  const item = { status: 'open', priority: 'high', count: 3, done: false };

  it('absent / empty predicate is always true', () => {
    expect(evaluateWhen(undefined, item)).toBe(true);
    expect(evaluateWhen('  ', item)).toBe(true);
  });

  it('equality + inequality (string-coerced)', () => {
    expect(evaluateWhen('status == open', item)).toBe(true);
    expect(evaluateWhen("status == 'open'", item)).toBe(true);
    expect(evaluateWhen('status != closed', item)).toBe(true);
    expect(evaluateWhen('status == closed', item)).toBe(false);
  });

  it('numeric comparisons', () => {
    expect(evaluateWhen('count > 2', item)).toBe(true);
    expect(evaluateWhen('count >= 3', item)).toBe(true);
    expect(evaluateWhen('count < 3', item)).toBe(false);
  });

  it('bare-field truthiness + negation', () => {
    expect(evaluateWhen('priority', item)).toBe(true);
    expect(evaluateWhen('done', item)).toBe(false);
    expect(evaluateWhen('!done', item)).toBe(true);
  });

  it('AND / OR composition', () => {
    expect(evaluateWhen('status == open && priority == high', item)).toBe(true);
    expect(evaluateWhen('status == open && priority == low', item)).toBe(false);
    expect(evaluateWhen('status == closed || count == 3', item)).toBe(true);
  });

  it('fails closed on a malformed predicate', () => {
    expect(evaluateWhen('status ==', item)).toBe(false);
    expect(evaluateWhen('1 + 1', item)).toBe(false);
  });
});

describe('validateWhen', () => {
  it('accepts valid predicates, rejects garbage', () => {
    expect(validateWhen('status == open && !done')).toBeNull();
    expect(validateWhen('a == 1 || b > 2')).toBeNull();
    expect(validateWhen('status ==')).not.toBeNull();
    expect(validateWhen('a && ')).not.toBeNull();
  });
});

describe('action_kinds vocabulary', () => {
  it('is the frozen 7-verb set', () => {
    expect([...ACTION_KINDS]).toEqual([
      'approve',
      'reject',
      'respond',
      'trigger_workflow',
      'steer',
      'assign',
      'comment',
    ]);
  });

  it('isActionKind guards the closed set', () => {
    expect(isActionKind('approve')).toBe(true);
    expect(isActionKind('teleport')).toBe(false);
  });

  it('enforces kind×source compatibility', () => {
    expect(isActionValidOnSource('approve', 'approval_queue')).toBe(true);
    expect(isActionValidOnSource('approve', 'task_collection')).toBe(false);
    expect(isActionValidOnSource('assign', 'task_collection')).toBe(true);
    expect(isActionValidOnSource('trigger_workflow', 'workflow_runs')).toBe(
      true,
    );
  });
});
