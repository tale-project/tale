import { describe, it, expect } from 'vitest';

import { FLOW_EDGE_COLORS } from '@/app/components/flow/edge-palette';

import { resolveConditionBranchEdge } from './use-automation-layout';

// Regression tests for #1486 (custom condition branches used to render as an
// unlabeled gray line) and #2370 (a condition's "No" branch used to render in
// the destructive red, which reads as an error — branches are never red).
describe('resolveConditionBranchEdge (#1486, #2370)', () => {
  it('maps negative keys to an amber "false" branch, never red (case-insensitive)', () => {
    for (const key of ['false', 'No', 'REJECT', 'failure', 'error']) {
      expect(resolveConditionBranchEdge(key)).toEqual({
        color: FLOW_EDGE_COLORS.negative,
        label: 'false',
        variant: 'negative',
      });
    }
    expect(FLOW_EDGE_COLORS.negative).not.toContain('destructive');
  });

  it('maps positive keys to a green "true" branch (case-insensitive)', () => {
    for (const key of ['true', 'Yes', 'APPROVE', 'success', 'default']) {
      expect(resolveConditionBranchEdge(key)).toEqual({
        color: FLOW_EDGE_COLORS.positive,
        label: 'true',
        variant: 'positive',
      });
    }
  });

  it('labels a custom branch key with its own name (no longer unlabeled)', () => {
    const result = resolveConditionBranchEdge('Check Has Cursor');
    expect(result.label).toBe('Check Has Cursor');
    expect(result.variant).toBe('neutral');
    expect(result.color).toBe(FLOW_EDGE_COLORS.flow);
  });
});

// The palette itself is the documented visual language — pin that every value
// is a semantic theme token (light + dark), never a raw hex.
describe('FLOW_EDGE_COLORS (#2370)', () => {
  it('only uses semantic theme tokens', () => {
    for (const color of Object.values(FLOW_EDGE_COLORS)) {
      expect(color).toMatch(/^hsl\(var\(--[a-z-]+\)\)$/);
    }
  });

  it('reserves red for error routes only', () => {
    expect(FLOW_EDGE_COLORS.error).toBe('hsl(var(--destructive))');
    expect(FLOW_EDGE_COLORS.flow).not.toContain('destructive');
    expect(FLOW_EDGE_COLORS.positive).not.toContain('destructive');
    expect(FLOW_EDGE_COLORS.negative).not.toContain('destructive');
  });
});
