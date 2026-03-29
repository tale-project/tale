import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import type { Checksums } from '../project/types';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import {
  computeContentHash,
  computeFileHash,
  readChecksums,
  writeChecksums,
} from '../project/checksums';
import { fetchReference, resolveRepoRoot } from '../project/fetch-reference';
import { findProject } from '../project/find-project';
import { readProject } from '../project/read-project';

interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
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

  logger.header(`${prefix}Updating Tale Project`);

  if (project.cliVersion === pkg.version && !options.force) {
    logger.success(`Already up to date (v${pkg.version})`);
    return;
  }

  logger.info(`Current version: ${project.cliVersion}`);
  logger.info(`Target version:  ${pkg.version}`);

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    throw new Error(
      'Could not find Tale repository. Production download is not yet supported.',
    );
  }

  // Update reference code
  logger.step(`${prefix}Updating reference code...`);
  if (!options.dryRun) {
    await fetchReference(projectDir, repoRoot);
  }

  // Read existing checksums
  const oldChecksums = await readChecksums(projectDir);
  const oldFiles = oldChecksums?.files ?? {};

  // Scan new example files
  const newExampleFiles = new Map<string, string>();
  await scanExampleFiles(
    join(repoRoot, 'examples', 'agents'),
    'agents',
    newExampleFiles,
  );
  await scanExampleFiles(
    join(repoRoot, 'examples', 'workflows'),
    'workflows',
    newExampleFiles,
  );
  await scanExampleFiles(
    join(repoRoot, 'examples', 'integrations'),
    'integrations',
    newExampleFiles,
  );

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
}

async function scanExampleFiles(
  srcDir: string,
  prefix: string,
  files: Map<string, string>,
): Promise<void> {
  if (!existsSync(srcDir)) {
    return;
  }

  await scanRecursive(srcDir, srcDir, prefix, files);
}

async function scanRecursive(
  dir: string,
  baseDir: string,
  prefix: string,
  files: Map<string, string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.history') {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await scanRecursive(fullPath, baseDir, prefix, files);
    } else {
      const content = await readFile(fullPath, 'utf-8');
      const relPath = join(prefix, relative(baseDir, fullPath));
      files.set(relPath, content);
    }
  }
}
