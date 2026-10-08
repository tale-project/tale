// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { Automation, Issue, NodeDef } from '../../types';
import { validate } from '../../validate';

function doc(node: Partial<NodeDef>): Automation {
  return {
    version: 1,
    name: 'conditions-probe',
    nodes: [{ id: 'main', type: 'transform', code: 'return 1;', ...node }],
    output: '{{ nodes.main.output }}',
  };
}

async function codes(node: Partial<NodeDef>): Promise<Issue[]> {
  const { warnings } = await validate(doc(node));
  return warnings.filter((w) =>
    ['CONDITION_CONSTANT', 'REPEAT_NEVER_TRUE', 'REPEAT_UNTIL_STATIC'].includes(
      w.code,
    ),
  );
}

describe('CONDITION_CONSTANT', () => {
  it('a when that text around the template makes always true', async () => {
    const [issue] = await codes({ when: 'go: {{ input.go }}' });
    expect(issue).toMatchObject({
      code: 'CONDITION_CONSTANT',
      at: { pointer: '/nodes/0/when' },
      params: { field: 'when', value: true, cause: 'mixed-text' },
    });
    expect(issue.hint).toBe(
      'write the condition as one template: "{{ input.go }}"',
    );
  });

  it.each(['{{ true }}', '{{ 1 < 2 }}', 'true', '{{ [] }}'])(
    'a when built from literals: %j',
    async (when) => {
      const [issue] = await codes({ when });
      expect(issue.params).toMatchObject({ field: 'when', cause: 'literal' });
    },
  );

  it('a repeatUntil that always holds runs once', async () => {
    const [issue] = await codes({ repeatUntil: '{{ true }}' });
    expect(issue.params).toMatchObject({ field: 'repeatUntil' });
    expect(issue.message).toContain('runs exactly once');
  });

  it('a when that depends on the run is no finding', async () => {
    expect(await codes({ when: '{{ input.go }}' })).toEqual([]);
  });
});

describe('REPEAT_NEVER_TRUE', () => {
  it.each<[number | undefined, number]>([
    [undefined, 5],
    [3, 3],
  ])('maxRepeats %s → %d passes', async (maxRepeats, passes) => {
    const [issue] = await codes({
      repeatUntil: '{{ false }}',
      ...(maxRepeats !== undefined && { maxRepeats }),
    });
    expect(issue).toMatchObject({
      code: 'REPEAT_NEVER_TRUE',
      params: { maxRepeats: passes },
    });
  });
});

describe('REPEAT_UNTIL_STATIC', () => {
  it('a condition that reads nothing a pass changes', async () => {
    const [issue] = await codes({ repeatUntil: '{{ input.done }}' });
    expect(issue).toMatchObject({
      code: 'REPEAT_UNTIL_STATIC',
      at: { pointer: '/nodes/0/repeatUntil' },
    });
  });

  it.each([
    '{{ output.done }}',
    '{{ nodes.main.output.done }}',
    'output === 1',
    '{{ Date.now() > input.until }}',
    '{{ Math.random() > 0.5 }}',
    '{{ nodes[input.which].output }}',
  ])('reading the pass is fine: %j', async (repeatUntil) => {
    expect(await codes({ repeatUntil })).toEqual([]);
  });
});
