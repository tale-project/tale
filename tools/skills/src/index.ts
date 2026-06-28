#!/usr/bin/env bun
/**
 * CLI entry for the skill sync + cross-harness adapter generator. The engine
 * itself lives in ./sync.ts (kept side-effect-free so it is unit-testable).
 *
 *   bun tools/skills/src/index.ts            # write synced copies + adapters (skills:sync)
 *   bun tools/skills/src/index.ts --check    # verify; exit 1 on drift       (skills:check)
 */

import { resolve } from 'node:path';

import { SKILLS_MANIFEST } from './manifest';
import { runSync } from './sync';

// index.ts lives at tools/skills/src/, so the repo root is three levels up.
const exitCode = await runSync({
  repoRoot: resolve(import.meta.dir, '../../..'),
  manifest: SKILLS_MANIFEST,
  check: process.argv.includes('--check'),
});
process.exit(exitCode);
