/**
 * Legacy flat-layout preflight: detect-and-migrate gate for `tale start`,
 * `tale deploy`, and `tale update`.
 *
 * Pre-Oct-2025 projects keep per-domain dirs (`agents/`, `workflows/`, …)
 * at the project root. The org-first layout expects them under
 * `default/<dir>/`. `migrateConfigLayout` already implements the move
 * idempotently with a host-side phase + a container-side phase.
 *
 * Per `feedback_migration_ux.md`, the surface UX should be:
 *
 *   1. The user just runs `tale start` / `tale deploy` / `tale update`.
 *   2. If a legacy layout is detected, prompt with a default-No confirm
 *      that summarises what will move.
 *   3. On accept, run the migration in-line; on decline, abort.
 *   4. On non-TTY (CI, scripts), the user must opt in via `--yes` —
 *      otherwise we abort with a clear message rather than silently
 *      migrating.
 *
 * No `tale migrate config-layout` user-facing subcommand. The library
 * function `migrateConfigLayout` stays so this preflight (and tests)
 * can call it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { confirm } from '../../utils/confirm';
import * as logger from '../../utils/logger';
import { LEGACY_DOMAIN_DIR_NAMES } from './deploy';
import { migrateConfigLayout } from './migrate-config-layout';

interface LegacyLayoutPreflightOptions {
  /** Absolute path of the project root to scan. */
  projectDir: string;
  /** Skip the prompt and migrate immediately (non-interactive flag). */
  assumeYes: boolean;
  /**
   * The command that triggered this preflight. Only shapes the prompt
   * copy — the migration steps are identical across commands.
   */
  context: 'start' | 'deploy' | 'update';
}

interface LegacyLayoutPreflightResult {
  /** True iff a migration was actually performed in this call. */
  migrated: boolean;
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

function detectLegacyDirs(projectDir: string): string[] {
  return [...LEGACY_DOMAIN_DIR_NAMES].filter((d) =>
    existsSync(join(projectDir, d)),
  );
}

/**
 * Run the detect → confirm → migrate flow. Throws when:
 *   - legacy layout exists but stdin is not a TTY and `--yes` was not
 *     supplied (operator must opt in explicitly in CI / scripts);
 *   - the user declines the interactive prompt;
 *   - the migration itself fails (e.g. host conflicts).
 *
 * Returns `{ migrated: true }` on a successful migration so the caller
 * can re-evaluate downstream state (`tale update` re-reads checksums
 * after the move, for example). Returns `{ migrated: false }` when no
 * legacy dirs were present.
 */
export async function legacyLayoutPreflight(
  options: LegacyLayoutPreflightOptions,
): Promise<LegacyLayoutPreflightResult> {
  const { projectDir, assumeYes, context } = options;
  const legacyDirs = detectLegacyDirs(projectDir);
  if (legacyDirs.length === 0) {
    return { migrated: false };
  }

  const dirsList = legacyDirs.map((d) => `${d}/`).join(', ');

  // Non-TTY + no --yes: fail loud rather than silently migrate. A CI
  // pipeline that hits this case should add the flag deliberately.
  if (!assumeYes && !isInteractive()) {
    throw new Error(
      `Legacy flat layout detected at project root: ${dirsList}\n` +
        `  The org-first layout expects these under "default/<domain>/".\n` +
        `  Re-run \`tale ${context} --yes\` to migrate in place,\n` +
        '  or move the dirs into `default/` manually. See ' +
        'docs/en/self-hosted/operate/upgrades.md for the runbook.',
    );
  }

  // Interactive + no --yes: ask. Default-No so a single Enter keystroke
  // doesn't trigger a destructive-shape operation.
  if (!assumeYes) {
    logger.blank();
    logger.warn(`Legacy flat layout detected at project root: ${dirsList}`);
    logger.info('  These dirs will move into "default/<dir>/" in place.');
    logger.info(
      '  The migration is rollback-insured: container-side providers/secrets ' +
        'are copied (not moved) and cleaned up only after you run ' +
        '`tale start` against the new layout. Host dirs are renamed atomically.',
    );
    const ok = await confirm('Migrate now?');
    if (!ok) {
      throw new Error(
        `Aborted: legacy layout still present. Re-run \`tale ${context}\` after migrating ` +
          'manually, or pass `--yes` to migrate non-interactively.',
      );
    }
  }

  logger.blank();
  logger.step('Running config-layout migration...');
  await migrateConfigLayout({
    dryRun: false,
    cleanupOld: false,
    projectDir,
  });
  return { migrated: true };
}
