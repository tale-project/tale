import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import { migrateOldVolumes } from '../docker/migrate-volumes';
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
import { generateAllRules } from '../rules/generators';

interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
  skipHeader?: boolean;
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

  // Legacy projects (pre-ID) get an ID auto-assigned here. We also attempt
  // volume migration immediately, but the migration function itself defers
  // (via a marker file) if any legacy containers are running, so production
  // deployments are never impacted by `tale upgrade`.
  let assignedId: string | undefined;
  if (!project.id) {
    assignedId = generateProjectId(basename(projectDir));
    project.id = assignedId;
    if (!options.dryRun) {
      await Bun.write(
        join(projectDir, 'tale.json'),
        JSON.stringify(project, null, 2) + '\n',
      );
      setProjectId(assignedId);
    }
    logger.blank();
    logger.info(`Assigned project ID: ${assignedId}`);
  }

  // Update reference code
  logger.step(`${prefix}Updating reference code...`);
  if (!options.dryRun) {
    await fetchReference(projectDir);
  }

  // Regenerate AI rules files
  logger.step(`${prefix}Updating AI rules files...`);
  if (!options.dryRun) {
    const rulesFiles = generateAllRules();
    for (const { relativePath, content } of rulesFiles) {
      const destPath = join(projectDir, relativePath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content);
    }
  }

  // Read existing checksums
  const oldChecksums = await readChecksums(projectDir);
  const oldFiles = oldChecksums?.files ?? {};

  // Get new example files from embedded data
  const newExampleFiles = new Map<string, string>();

  for (const [relPath, content] of getEmbeddedExamples('agents')) {
    newExampleFiles.set(join('agents', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('workflows')) {
    newExampleFiles.set(join('workflows', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('integrations')) {
    newExampleFiles.set(join('integrations', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('branding')) {
    newExampleFiles.set(join('branding', relPath), content);
  }
  for (const [relPath, content] of getEmbeddedExamples('providers')) {
    if (!relPath.endsWith('.secrets.json')) {
      newExampleFiles.set(join('providers', relPath), content);
    }
  }

  // Classify and apply changes
  const summary: UpdateSummary = {
    updated: [],
    added: [],
    skipped: [],
    removed: [],
  };

  const newChecksumFiles: Record<string, string> = {};

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
    await Bun.write(
      join(projectDir, 'tale.json'),
      JSON.stringify(updatedProject, null, 2) + '\n',
    );

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

  // Attempt to migrate legacy Docker volumes for newly-assigned IDs.
  // This is safe — the migration function defers if any legacy containers are
  // running, so production deployments remain untouched by `tale upgrade`.
  if (assignedId && !options.dryRun) {
    logger.blank();
    const result = await migrateOldVolumes(assignedId, projectDir);
    if (result.deferred) {
      // Message already logged by migrateOldVolumes
    } else if (
      result.migrated.length === 0 &&
      result.failed.length === 0 &&
      result.skipped.length === 0
    ) {
      // No legacy volumes existed; silent
    } else {
      logger.success(
        `Volume migration: ${result.migrated.length} migrated, ${result.skipped.length} skipped, ${result.failed.length} failed`,
      );
    }
  }
}
