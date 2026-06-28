/**
 * Drift guard — runs as part of `bun test` (no dedicated CI job). Fails the
 * suite if any committed skill copy or cross-harness adapter has drifted from
 * its source, or if a shipped skill breaks the portability contract. The fix is
 * always `bun run skills:sync`.
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { planAdapters } from '../src/adapters';
import { SKILLS_MANIFEST } from '../src/manifest';
import { validateManifest } from '../src/manifest-validate';
import { planSync } from '../src/sync';

// tests/ lives at tools/skills/tests/, so the repo root is three levels up.
const repoRoot = resolve(import.meta.dir, '../../..');

describe('committed skills are in sync with their source', () => {
  test('the manifest is valid', () => {
    expect(() => validateManifest(SKILLS_MANIFEST, repoRoot)).not.toThrow();
  });

  test('every synced skill copy matches its source and passes the guards', () => {
    for (const plan of planSync({
      repoRoot,
      manifest: SKILLS_MANIFEST,
      check: true,
    })) {
      expect(plan.importViolations).toEqual([]);
      expect(plan.commandViolations).toEqual([]);
      for (const target of plan.targets) {
        // Spread the skill name into the diff so a failure names the offender.
        expect({
          skill: plan.name,
          target: target.target,
          ...target.diff,
        }).toEqual({
          skill: plan.name,
          target: target.target,
          changed: [],
          missing: [],
          extra: [],
        });
      }
    }
  });

  test('every cross-harness adapter matches its SKILL.md + skill-globs.json', () => {
    const adapters = planAdapters(repoRoot);
    expect(adapters.errors).toEqual([]);
    expect(adapters.diff).toEqual({ changed: [], missing: [], extra: [] });
  });
});
