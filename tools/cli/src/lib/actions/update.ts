import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import {
  computeContentHash,
  computeFileHash,
  readChecksums,
  writeChecksums,
} from '../project/checksums';
import {
  fetchReference,
  getEmbeddedExamples,
} from '../project/fetch-reference';
import { findProject } from '../project/find-project';
import { generateProjectId } from '../project/generate-project-id';
import { setProjectId } from '../project/project-context';
import { readProject } from '../project/read-project';
import type { Checksums } from '../project/types';
import { writeProject } from '../project/write-project';
import { generateAllRules } from '../rules/generators';
import { legacyLayoutPreflight } from './legacy-layout-preflight';

interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
  skipHeader?: boolean;
  /**
   * Non-interactive: auto-accept the legacy-layout migration prompt
   * when a pre-org-first project root is detected.
   */
  assumeYes?: boolean;
}

interface UpdateSummary {
  updated: string[];
  added: string[];
  skipped: string[];
  removed: string[];
}

export async function update(options: UpdateOptions): Promise<void> {
  const projectDir = findProject();
  if (!projectDir) {
    throw new Error('No Tale project found. Run "tale init" to create one.');
  }

  const project = await readProject(projectDir);
  const prefix = options.dryRun ? '[DRY-RUN] ' : '';

  if (!options.skipHeader) {
    logger.header(`${prefix}Updating Tale Project`);
  }

  logger.info(`Current version: ${project.cliVersion}`);
  logger.info(`Target version:  ${pkg.version}`);

  // Resolve (or assign) the project ID and prime the module-level singleton
  // BEFORE the legacy-layout preflight. The preflight may run
  // `migrateConfigLayout`, whose container-side phase derives the convex
  // container name from `getProjectId()`; without a primed singleton it throws
  // "Project context not initialized" — and by then Phase 1 has already
  // irreversibly moved the host dirs. Legacy projects (pre-ID) get an ID
  // auto-assigned + persisted here; projects that already have one still need
  // the singleton primed (the old `!project.id` branch skipped them).
  let assignedId: string | undefined;
  if (!project.id) {
    assignedId = generateProjectId(basename(projectDir));
    project.id = assignedId;
    if (!options.dryRun) {
      await writeProject(join(projectDir, 'tale.json'), project);
    }
    logger.blank();
    logger.info(`Assigned project ID: ${assignedId}`);
  }
  if (!options.dryRun && project.id) {
    setProjectId(project.id);
  }

  // If the project is on the pre-org-first layout, migrate now (before
  // we write any new `default/<domain>/...` files). Without this gate
  // `tale update` happily lays the new tree down next to the legacy
  // dirs, and the subsequent `tale start` then refuses to boot — a
  // user-visible deadlock. The preflight prompts in interactive runs
  // and requires `--yes` in non-TTY contexts.
  if (!options.dryRun) {
    // Snapshot policy {}: auto-resolve the volume prefix (prod volumes win
    // over dev) and snapshot before the migration touches the convex data
    // volume; warns and proceeds when no data volumes exist yet.
    await legacyLayoutPreflight({
      projectDir,
      assumeYes: options.assumeYes ?? false,
      context: 'update',
      backup: {},
    });
  }

  // Update reference code
  logger.step(`${prefix}Updating reference code...`);
  if (!options.dryRun) {
    await fetchReference(projectDir);
  }

  // Read existing checksums BEFORE rewriting rules so we can apply the
  // same modified/unmodified policy as example files.
  const oldChecksums = await readChecksums(projectDir);
  const oldFiles = oldChecksums?.files ?? {};

  // Regenerate AI rules files. Same protection policy as examples:
  // - new file → write
  // - deleted by user → skip
  // - unmodified-since-last-update → overwrite
  // - locally modified + no --force → keep, warn
  // - locally modified + --force → overwrite
  logger.step(`${prefix}Updating AI rules files...`);
  const rulesFiles = generateAllRules();
  const rulesUpdates: Record<string, string> = {};
  for (const { relativePath, content } of rulesFiles) {
    const destPath = join(projectDir, relativePath);
    const newHash = computeContentHash(content);
    const oldHash = oldFiles[relativePath];

    if (!oldHash && !existsSync(destPath)) {
      logger.info(`${prefix}+ ${relativePath} (new)`);
      if (!options.dryRun) {
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, content);
      }
      rulesUpdates[relativePath] = newHash;
    } else if (!oldHash) {
      // File present on disk but missing from checksums.json — treat
      // as locally-modified (likely a project init'd by a pre-fix CLI
      // version that wrote the rules files without recording their
      // hashes). Preserve user edits; require --force to overwrite.
      // Round-2 P1-34 defense in depth.
      if (options.force) {
        logger.warn(
          `${prefix}~ ${relativePath} (overwritten, no recorded hash)`,
        );
        if (!options.dryRun) {
          await writeFile(destPath, content);
        }
        rulesUpdates[relativePath] = newHash;
      } else {
        logger.warn(
          `${prefix}! ${relativePath} (present on disk but no recorded hash; preserving — pass --force to overwrite)`,
        );
      }
    } else if (!existsSync(destPath)) {
      logger.info(`${prefix}- ${relativePath} (deleted by user, skipping)`);
    } else {
      const currentHash = await computeFileHash(destPath);
      if (currentHash === oldHash) {
        logger.info(`${prefix}~ ${relativePath} (updated)`);
        if (!options.dryRun) {
          await writeFile(destPath, content);
        }
        rulesUpdates[relativePath] = newHash;
      } else if (options.force) {
        logger.warn(
          `${prefix}~ ${relativePath} (overwritten, was locally modified)`,
        );
        if (!options.dryRun) {
          await writeFile(destPath, content);
        }
        rulesUpdates[relativePath] = newHash;
      } else {
        logger.warn(
          `${prefix}⚠ Skipped ${relativePath} (locally modified). Re-run with --force to overwrite.`,
        );
        rulesUpdates[relativePath] = oldHash;
      }
    }
  }

  // Get new example files from embedded data. Paths land under
  // `default/<domain>/...` to match the org-first layout that
  // `tale init` scaffolds.
  const newExampleFiles = new Map<string, string>();
  const DEFAULT_ORG = 'default';

  for (const [relPath, content] of getEmbeddedExamples('agents')) {
    newExampleFiles.set(join(DEFAULT_ORG, 'agents', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('workflows')) {
    newExampleFiles.set(join(DEFAULT_ORG, 'workflows', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('integrations')) {
    newExampleFiles.set(join(DEFAULT_ORG, 'integrations', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('branding')) {
    newExampleFiles.set(join(DEFAULT_ORG, 'branding', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('providers')) {
    if (!relPath.endsWith('.secrets.json')) {
      newExampleFiles.set(join(DEFAULT_ORG, 'providers', relPath), content);
    }
  }
  for (const [relPath, content] of getEmbeddedExamples('skills')) {
    newExampleFiles.set(join(DEFAULT_ORG, 'skills', relPath), content);
  }

  // Classify and apply changes
  const summary: UpdateSummary = {
    updated: [],
    added: [],
    skipped: [],
    removed: [],
  };

  // Seed checksum map with the rules-file decisions so the final write
  // includes their hashes (so future updates can detect local edits).
  const newChecksumFiles: Record<string, string> = { ...rulesUpdates };

  for (const [relPath, content] of newExampleFiles) {
    const destPath = join(projectDir, relPath);
    const newHash = computeContentHash(content);
    const oldHash = oldFiles[relPath];

    if (!oldHash) {
      // New file — copy it
      logger.info(`${prefix}+ ${relPath} (new)`);
      if (!options.dryRun) {
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, content);
      }
      newChecksumFiles[relPath] = newHash;
      summary.added.push(relPath);
    } else if (!existsSync(destPath)) {
      // Deleted by user — don't re-add
      logger.info(`${prefix}- ${relPath} (deleted by user, skipping)`);
      summary.removed.push(relPath);
    } else {
      const currentHash = await computeFileHash(destPath);

      if (currentHash === oldHash) {
        // Unmodified — safe to overwrite
        logger.info(`${prefix}~ ${relPath} (updated)`);
        if (!options.dryRun) {
          await writeFile(destPath, content);
        }
        newChecksumFiles[relPath] = newHash;
        summary.updated.push(relPath);
      } else if (options.force) {
        // Modified but --force — overwrite
        logger.warn(
          `${prefix}~ ${relPath} (overwritten, was locally modified)`,
        );
        if (!options.dryRun) {
          await writeFile(destPath, content);
        }
        newChecksumFiles[relPath] = newHash;
        summary.updated.push(relPath);
      } else {
        // Modified — skip
        logger.warn(
          `${prefix}⚠ Skipped ${relPath} (locally modified). New version at .tale/reference/examples/${relPath}`,
        );
        newChecksumFiles[relPath] = oldHash;
        summary.skipped.push(relPath);
      }
    }
  }

  // Update tale.json and checksums
  if (!options.dryRun) {
    const updatedProject = {
      ...project,
      cliVersion: pkg.version,
    };
    await writeProject(join(projectDir, 'tale.json'), updatedProject);

    const checksums: Checksums = {
      cliVersion: pkg.version,
      files: newChecksumFiles,
    };
    await writeChecksums(projectDir, checksums);
  }

  // Print summary
  logger.blank();
  logger.success(`${prefix}Update complete`);
  logger.table([
    ['Updated', `${summary.updated.length} files`],
    ['Added', `${summary.added.length} files`],
    ['Skipped', `${summary.skipped.length} files (locally modified)`],
    ['Removed', `${summary.removed.length} files (deleted by user)`],
  ]);

  if (summary.skipped.length > 0) {
    logger.blank();
    logger.info(
      'Skipped files can be compared against .tale/reference/examples/ to merge changes.',
    );
  }

  // (Auto-migration planning removed — `tale migrate config-layout` is the
  // only opt-in, manually-run migration now; operators invoke it directly.)
}
