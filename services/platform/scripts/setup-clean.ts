#!/usr/bin/env bun
/*
  Remove the local Convex deployment state so the next `bun run dev` starts
  from a clean backend.

  When the local Convex deployment gets into a bad state — a corrupt SQLite
  file, a stale schema after an aborted migration, a half-pushed function set
  — `bun run dev` can fail in the pre-warm step with an opaque error. The fix
  is to delete `.convex/local/` and let the CLI bootstrap a fresh anonymous
  deployment. This script does exactly that, and nothing else.

  Safety: this is a destructive operation, so the target is computed from this
  file's own location (never from an argument), resolved to an absolute path,
  and asserted to sit inside the repo's `services/platform/.convex/` directory
  before anything is removed. A target that escapes that directory aborts with
  a non-zero exit instead of deleting it. Pass `--force` (or `-f`) to skip the
  confirmation prompt; without a TTY and without `--force` it refuses to run.
*/

import { existsSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

const PLATFORM_ROOT = join(import.meta.dir, '..');
const CONVEX_ROOT = resolve(PLATFORM_ROOT, '.convex');
const LOCAL_DIR = resolve(CONVEX_ROOT, 'local');

/** Throw unless `target` is a path strictly inside `CONVEX_ROOT`. Guards
 *  against ever removing CONVEX_ROOT itself or anything outside it. */
function assertInsideConvexRoot(target: string): void {
  const rel = relative(CONVEX_ROOT, resolve(target));
  // An empty rel means target === CONVEX_ROOT; a leading `..` means it escapes.
  // Either way we refuse — only a strict child is deletable.
  if (rel === '' || rel.startsWith('..')) {
    throw new Error(
      `Refusing to delete ${target}: it is not strictly inside ${CONVEX_ROOT}.`,
    );
  }
  // Belt and braces: CONVEX_ROOT must itself be the platform's `.convex`
  // directory (not `/`, `~`, or anything else a mis-resolved import.meta.dir
  // could produce).
  if (dirname(CONVEX_ROOT) !== resolve(PLATFORM_ROOT)) {
    throw new Error(
      `Refusing to run: ${CONVEX_ROOT} is not the platform .convex directory.`,
    );
  }
}

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(
    `Delete local Convex state at ${LOCAL_DIR}? This loses all local dev data. [y/N] `,
  );
  for await (const chunk of process.stdin) {
    const answer = chunk.toString().trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  }
  return false;
}

async function main() {
  const force = process.argv
    .slice(2)
    .some((a) => a === '--force' || a === '-f');

  assertInsideConvexRoot(LOCAL_DIR);

  if (!existsSync(LOCAL_DIR)) {
    console.log(`Nothing to clean — ${LOCAL_DIR} does not exist.`);
    return;
  }

  if (!force) {
    const proceed = await confirm();
    if (!proceed) {
      console.log(
        'Aborted. Re-run with --force to delete without a prompt (e.g. in CI).',
      );
      process.exit(1);
    }
  }

  rmSync(LOCAL_DIR, { recursive: true, force: true });
  console.log(
    `Removed ${LOCAL_DIR}. The next \`bun run dev\` will bootstrap a fresh local Convex deployment.`,
  );
}

main().catch((err) => {
  console.error(
    'setup-clean failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
