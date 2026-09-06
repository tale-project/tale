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
  DEFAULT_README_CONTENT,
  DEFAULT_README_RELPATH,
} from '../project/default-readme';
import {
  fetchReference,
  getEmbeddedExamples,
} from '../project/fetch-reference';
import { findProject } from '../project/find-project';
import { generateProjectId } from '../project/generate-project-id';
import { SCAFFOLD_DOMAINS } from '../project/org-dirs';
import { setProjectId } from '../project/project-context';
import { readProject } from '../project/read-project';
import type { Checksums } from '../project/types';
import { writeProject } from '../project/write-project';
import { writeAgentInstructions } from '../rules/generators';

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

  // Resolve (or assign) the project ID and prime the module-level singleton.
  // Projects without an ID get one auto-assigned + persisted here; projects
  // that already have one still need the singleton primed.
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

  // Update reference code
  logger.step(`${prefix}Updating reference code...`);
  if (!options.dryRun) {
    await fetchReference(projectDir);
  }

  // Read existing checksums BEFORE rewriting rules so we can apply the
  // same modified/unmodified policy as example files.
  const oldChecksums = await readChecksums(projectDir);
  const oldFiles = oldChecksums?.files ?? {};

  // Refresh the agent instructions. AGENTS.md / CLAUDE.md are written through
  // a managed marker block (writeAgentInstructions), so any user content
  // *outside* the block is preserved on every run — no per-file hash/force
  // dance is needed to protect local edits.
  logger.step(`${prefix}Updating agent instructions (AGENTS.md, CLAUDE.md)...`);
  const rulesUpdates: Record<string, string> = {};
  if (options.dryRun) {
    logger.info(`${prefix}~ AGENTS.md, CLAUDE.md (managed section)`);
  } else {
    for (const { relativePath, content } of await writeAgentInstructions(
      projectDir,
    )) {
      logger.info(`${prefix}~ ${relativePath} (managed section)`);
      rulesUpdates[relativePath] = computeContentHash(content);
    }
  }

  // Get new example files from embedded data. Paths land under
  // `default/<domain>/...` to match the org-first layout that
  // `tale init` scaffolds.
  const newExampleFiles = new Map<string, string>();
  const DEFAULT_ORG = 'default';

  // Public files of every embedded catalog domain (see SCAFFOLD_DOMAINS);
  // encrypted *.secrets.json sidecars are never scaffolded.
  for (const domain of SCAFFOLD_DOMAINS) {
    for (const [relPath, content] of getEmbeddedExamples(domain)) {
      if (relPath.endsWith('.secrets.json')) continue;
      newExampleFiles.set(join(DEFAULT_ORG, domain, relPath), content);
    }
  }
  // The default/ README is CLI-generated (not in the embedded catalog) but
  // sync-managed under the same policy as every other scaffold file:
  // overwritten while unmodified, skipped once edited, never re-added after
  // the user deletes it.
  newExampleFiles.set(DEFAULT_README_RELPATH, DEFAULT_README_CONTENT);

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
        // Modified — skip. The embedded reference tree is the generic
        // `builtin-configs/<domain>/...` catalog (no org level), so map the
        // project-layout relPath (`default/<domain>/...`) back onto it.
        // The CLI-generated README has no reference copy to point at.
        const referenceHint =
          relPath === DEFAULT_README_RELPATH
            ? ''
            : ` New version at .tale/reference/${relPath.replace(/^default\//, 'builtin-configs/')}`;
        logger.warn(
          `${prefix}Skipped ${relPath} (locally modified).${referenceHint}`,
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
      'Skipped files can be compared against .tale/reference/builtin-configs/ to merge changes.',
    );
  }
}
