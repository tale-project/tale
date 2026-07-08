#!/usr/bin/env bun
/*
  Remove the local Convex deployment state so the next `bun run dev` starts
  from a clean backend.

  When the local Convex deployment gets into a bad state — a corrupt SQLite
  file, a stale schema after an aborted migration, a half-pushed function set
  — `bun run dev` can fail in the pre-warm step with an opaque error. Deleting
  `.convex/local/` and letting the CLI bootstrap a fresh anonymous deployment
  is the last-resort fix.

  DESTRUCTIVE — wipes every local Convex table, upload, and function bundle under
  `services/platform/.convex/local/`. Org config on disk and `.env.local` are
  untouched.

  Safety gates (all intentional — do not add a `--force` bypass):
    - Target path is computed from this file's location only (never from argv).
    - Target must sit strictly inside `services/platform/.convex/`.
    - Interactive TTY: type the exact phrase `delete local convex`.
    - Non-interactive: set TALE_CONFIRM_DESTROY_LOCAL_CONVEX=delete-local-convex
      (for CI only — coding agents must not set this without explicit human
      approval; repo AGENTS.md forbids destroying local state otherwise).

  Coding agents: never run this script unless the user explicitly asked to wipe
  local Convex dev data. Prefer automatic dev maintenance (module prune) first.
*/

import { existsSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';

import { convexLocalPaths } from './convex-local-maintenance';
import {
  canDestroyLocalConvex,
  DESTROY_LOCAL_CONVEX_PHRASE,
} from './setup-clean-gate';

export {
  canDestroyLocalConvex,
  DESTROY_LOCAL_CONVEX_ENV,
  DESTROY_LOCAL_CONVEX_ENV_VALUE,
  DESTROY_LOCAL_CONVEX_PHRASE,
} from './setup-clean-gate';

const PLATFORM_ROOT = join(import.meta.dir, '..');
const CONVEX_ROOT = resolve(PLATFORM_ROOT, '.convex');
const LOCAL_DIR = resolve(convexLocalPaths(PLATFORM_ROOT).localDir);

/** Throw unless `target` is a path strictly inside `CONVEX_ROOT`. */
function assertInsideConvexRoot(target: string): void {
  const rel = relative(CONVEX_ROOT, resolve(target));
  if (rel === '' || rel.startsWith('..')) {
    throw new Error(
      `Refusing to delete ${target}: it is not strictly inside ${CONVEX_ROOT}.`,
    );
  }
  if (dirname(CONVEX_ROOT) !== resolve(PLATFORM_ROOT)) {
    throw new Error(
      `Refusing to run: ${CONVEX_ROOT} is not the platform .convex directory.`,
    );
  }
}

async function readTypedConfirmation(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    process.stdout.write(
      `\nThis permanently deletes all local Convex dev data under:\n  ${LOCAL_DIR}\n\nType "${DESTROY_LOCAL_CONVEX_PHRASE}" to confirm: `,
    );
    return await rl.question('');
  } finally {
    rl.close();
  }
}

async function main() {
  assertInsideConvexRoot(LOCAL_DIR);

  if (!existsSync(LOCAL_DIR)) {
    console.log(`Nothing to clean — ${LOCAL_DIR} does not exist.`);
    return;
  }

  const typedAnswer = await readTypedConfirmation();
  const gate = canDestroyLocalConvex({
    isTty: process.stdin.isTTY,
    typedAnswer,
    env: process.env,
  });
  if (!gate.ok) {
    console.error(gate.reason);
    process.exit(1);
  }

  removeLocalConvexDeployment(LOCAL_DIR);
  console.log(
    `Removed ${LOCAL_DIR}. The next \`bun run dev\` will bootstrap a fresh local Convex deployment.`,
  );
}

/** Delete the local Convex deployment directory. Not called by dev maintenance. */
export function removeLocalConvexDeployment(
  localDir: string = LOCAL_DIR,
): void {
  assertInsideConvexRoot(localDir);
  if (!existsSync(localDir)) return;
  rmSync(localDir, { recursive: true, force: true });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      'setup-clean failed:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
