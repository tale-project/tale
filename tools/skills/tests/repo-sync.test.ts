/**
 * Drift guard — runs as part of `bun test` (no dedicated CI job). Fails the
 * suite if the committed `.claude/skills` mirror has drifted from its
 * `.agents/skills` source, or if a shipped skill breaks the portability
 * contract. The fix is always `bun run skills:sync`.
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { planGuards, planMirror, planProjection } from '../src/sync';

// tests/ lives at tools/skills/tests/, so the repo root is three levels up.
const repoRoot = resolve(import.meta.dir, '../../..');

describe('committed skills are in sync with their source', () => {
  test('the .claude/skills mirror matches its .agents/skills source', () => {
    expect(planMirror(repoRoot).diff).toEqual({
      changed: [],
      missing: [],
      extra: [],
    });
  });

  test('every workflow skill projection matches its builtin-configs source', () => {
    for (const plan of planProjection(repoRoot)) {
      expect(plan.diff).toEqual({ changed: [], missing: [], extra: [] });
    }
  });

  test('every shipped skill passes the portability guards', () => {
    const guards = planGuards(repoRoot);
    expect(guards.imports).toEqual([]);
    expect(guards.commands).toEqual([]);
  });
});
