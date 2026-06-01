import { describe, it, expect } from 'vitest';

import { resolveConditionBranchEdge } from './use-automation-layout';

// Regression test for #1486: condition branches with a custom key used to
// render as an unlabeled gray line, making the flow ambiguous. Every branch
// must now carry a label.
describe('resolveConditionBranchEdge (#1486)', () => {
  it('maps negative keys to a red "false" edge (case-insensitive)', () => {
    for (const key of ['false', 'No', 'REJECT', 'failure', 'error']) {
      expect(resolveConditionBranchEdge(key)).toEqual({
        color: 'hsl(var(--destructive))',
        label: 'false',
      });
    }
  });

  it('maps positive keys to a green "true" edge (case-insensitive)', () => {
    for (const key of ['true', 'Yes', 'APPROVE', 'success', 'default']) {
      expect(resolveConditionBranchEdge(key)).toEqual({
        color: 'hsl(var(--chart-2))',
        label: 'true',
      });
    }
  });

  it('labels a custom branch key with its own name (no longer unlabeled)', () => {
    const result = resolveConditionBranchEdge('Check Has Cursor');
    expect(result.label).toBe('Check Has Cursor');
    expect(result.color).toBeTruthy();
  });
});
