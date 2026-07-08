import { describe, expect, it } from 'vitest';

import {
  canonicalizeAgentConfig,
  canonicalizeWorkflowConfig,
  sortObjectKeysDeep,
  sortStringArrayFields,
} from './canonicalize-config';

describe('sortObjectKeysDeep', () => {
  it('sorts keys of nested objects', () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    expect(JSON.stringify(sortObjectKeysDeep(input))).toBe(
      JSON.stringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('preserves array element order but sorts objects inside arrays', () => {
    const input = { list: [{ z: 1, a: 2 }, { y: 3 }] };
    const out = sortObjectKeysDeep(input);
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({ list: [{ a: 2, z: 1 }, { y: 3 }] }),
    );
  });

  it('leaves primitives untouched', () => {
    expect(sortObjectKeysDeep(42)).toBe(42);
    expect(sortObjectKeysDeep('x')).toBe('x');
    expect(sortObjectKeysDeep(null)).toBe(null);
  });
});

describe('sortStringArrayFields', () => {
  it('sorts and dedupes only the named string-array fields', () => {
    const out = sortStringArrayFields(
      { tags: ['b', 'a', 'b'], order: ['z', 'a'] },
      ['tags'],
    );
    expect(out.tags).toEqual(['a', 'b']);
    // untouched field keeps its order
    expect(out.order).toEqual(['z', 'a']);
  });

  it('ignores absent or non-string-array fields', () => {
    const out = sortStringArrayFields({ nums: [3, 1, 2] }, ['nums', 'missing']);
    expect(out.nums).toEqual([3, 1, 2]);
  });
});

describe('canonicalizeAgentConfig', () => {
  it('sorts set-like arrays but preserves ordered ones', () => {
    const out = canonicalizeAgentConfig({
      toolNames: ['web', 'calc', 'calc'],
      skillBindings: ['c', 'a', 'b'],
      supportedModels: ['gpt-4', 'haiku'], // fallback chain — preserved
      conversationStarters: ['Hi', 'Bye'], // display order — preserved
    });
    expect(out.toolNames).toEqual(['calc', 'web']);
    expect(out.skillBindings).toEqual(['a', 'b', 'c']);
    expect(out.supportedModels).toEqual(['gpt-4', 'haiku']);
    expect(out.conversationStarters).toEqual(['Hi', 'Bye']);
  });

  it('does not mutate the input', () => {
    const input = { toolNames: ['b', 'a'] };
    canonicalizeAgentConfig(input);
    expect(input.toolNames).toEqual(['b', 'a']);
  });
});

describe('canonicalizeWorkflowConfig', () => {
  it('sorts steps by stepSlug (execution order is order/nextSteps-driven)', () => {
    const out = canonicalizeWorkflowConfig({
      steps: [
        { stepSlug: 'zeta', order: 0 },
        { stepSlug: 'alpha', order: 1 },
      ],
    });
    expect(out.steps.map((s: { stepSlug: string }) => s.stepSlug)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('sorts requires.integrations by name and their operations', () => {
    const out = canonicalizeWorkflowConfig({
      requires: {
        integrations: [
          { name: 'slack', operations: ['send', 'archive'] },
          { name: 'github' },
        ],
      },
    });
    const integrations = out.requires.integrations as Array<{
      name: string;
      operations?: string[];
    }>;
    expect(integrations.map((i) => i.name)).toEqual(['github', 'slack']);
    expect(integrations[1].operations).toEqual(['archive', 'send']);
  });
});
