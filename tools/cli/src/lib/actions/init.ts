import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import { computeContentHash, writeChecksums } from '../project/checksums';
import { fetchReference, resolveRepoRoot } from '../project/fetch-reference';
import { CURRENT_PROJECT_VERSION, type Checksums } from '../project/types';

interface InitOptions {
  directory?: string;
  force?: boolean;
  noEnv?: boolean;
}

const CLAUDE_MD_CONTENT = `# Tale Project

This is a Tale project. Editable configs are in \`agents/\`, \`workflows/\`, and \`integrations/\`.

## Key reference code (read-only, for understanding schemas and constraints)

- \`.tale/reference/schemas/agents.ts\` — Agent JSON schema (Zod). Defines all valid fields for agent configs.
- \`.tale/reference/schemas/workflows.ts\` — Workflow JSON schema (Zod). Defines step types, config structure.
- \`.tale/reference/schemas/integrations.ts\` — Integration JSON schema (Zod). Defines config.json structure, auth methods, operations.
- \`.tale/reference/convex/agents/file_actions.ts\` — How agent files are read/written. Naming rules, validation.
- \`.tale/reference/convex/workflows/file_actions.ts\` — How workflow files are read/written. Slug format, history.
- \`.tale/reference/convex/integrations/file_actions.ts\` — How integration files are read/written. Directory structure, validation.
- \`.tale/reference/examples/\` — Canonical examples from this Tale version.

## Editing rules

- Agent filenames must match: \`[a-z0-9][a-z0-9_-]*\\.json\`
- Workflow files are organized by category in subdirectories
- Each integration is a directory containing: \`config.json\` (metadata + operations), \`connector.ts\` (runtime code), \`icon.svg\` (UI icon)
- Integration directory names must be lowercase alphanumeric with hyphens/underscores
- Refer to the Zod schemas for valid field values and constraints
`;

const GITIGNORE_ENTRIES = ['.tale/', '.env'];

export async function init(options: InitOptions): Promise<void> {
  const target = resolve(options.directory ?? process.cwd());
  const taleJsonPath = join(target, 'tale.json');

  logger.header('Initializing Tale Project');

  // Check for existing project
  if (existsSync(taleJsonPath) && !options.force) {
    throw new Error(
      `tale.json already exists in ${target}. Use --force to overwrite.`,
    );
  }

  // Resolve monorepo root
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    throw new Error(
      'Could not find Tale repository. Production download is not yet supported.',
    );
  }

  logger.info(`Project directory: ${target}`);
  logger.info(`Source repository: ${repoRoot}`);

  // Ensure target directory exists
  await mkdir(target, { recursive: true });

  // Fetch reference code
  logger.step('Copying reference code to .tale/reference/...');
  await mkdir(join(target, '.tale'), { recursive: true });
  await fetchReference(target, repoRoot);

  // Copy agents
  logger.step('Copying agent configurations...');
  const agentFiles = await copyExampleFiles(
    join(repoRoot, 'examples', 'agents'),
    join(target, 'agents'),
  );

  // Copy workflows
  logger.step('Copying workflow configurations...');
  const workflowFiles = await copyExampleFiles(
    join(repoRoot, 'examples', 'workflows'),
    join(target, 'workflows'),
  );

  // Copy integrations
  logger.step('Copying integration configurations...');
  const integrationFiles = await copyExampleFiles(
    join(repoRoot, 'examples', 'integrations'),
    join(target, 'integrations'),
  );

  // Compute checksums
  logger.step('Computing file checksums...');
  const allFiles = new Map<string, string>();

  for (const [relPath, content] of agentFiles) {
    allFiles.set(join('agents', relPath), computeContentHash(content));
  }
  for (const [relPath, content] of workflowFiles) {
    allFiles.set(join('workflows', relPath), computeContentHash(content));
  }
  for (const [relPath, content] of integrationFiles) {
    allFiles.set(join('integrations', relPath), computeContentHash(content));
  }

  const checksums: Checksums = {
    cliVersion: pkg.version,
    files: Object.fromEntries(allFiles),
  };
  await writeChecksums(target, checksums);

  // Write tale.json
  logger.step('Writing tale.json...');
  const project = {
    version: CURRENT_PROJECT_VERSION,
    cliVersion: pkg.version,
    createdAt: new Date().toISOString(),
  };
  await Bun.write(taleJsonPath, JSON.stringify(project, null, 2) + '\n');

  // Write CLAUDE.md
  logger.step('Writing CLAUDE.md...');
  await Bun.write(join(target, 'CLAUDE.md'), CLAUDE_MD_CONTENT);

  // Ensure .gitignore
  await ensureGitignore(target);

  // .env setup
  if (!options.noEnv) {
    const { ensureEnv } = await import('../config/ensure-env');
    logger.blank();
    await ensureEnv({ deployDir: target, skipIfExists: true });
  }

  logger.blank();
  logger.success('Tale project initialized!');
  logger.blank();
  logger.table([
    ['Project', target],
    ['CLI version', pkg.version],
    ['Agents', `${agentFiles.size} files`],
    ['Workflows', `${workflowFiles.size} files`],
    ['Integrations', `${integrationFiles.size} files`],
  ]);
  logger.blank();
  logger.info('Next steps:');
  logger.info(
    '  1. Edit agents/, workflows/, and integrations/ to customize your setup',
  );
  logger.info('  2. Run "tale start" to launch the platform locally');
}

async function copyExampleFiles(
  srcDir: string,
  destDir: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  if (!existsSync(srcDir)) {
    return files;
  }

  await mkdir(destDir, { recursive: true });
  await copyRecursive(srcDir, destDir, srcDir, files);

  return files;
}

async function copyRecursive(
  srcDir: string,
  destDir: string,
  baseDir: string,
  files: Map<string, string>,
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip .history directories
    if (entry.name === '.history') {
      continue;
    }

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyRecursive(srcPath, destPath, baseDir, files);
    } else {
      const content = await readFile(srcPath, 'utf-8');
      await writeFile(destPath, content);
      const relPath = relative(baseDir, srcPath);
      files.set(relPath, content);
    }
  }
}

async function ensureGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, '.gitignore');
  let content = '';

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8');
  }

  const lines = content.split('\n');
  const missingEntries = GITIGNORE_ENTRIES.filter(
    (entry) => !lines.some((line) => line.trim() === entry),
  );

  if (missingEntries.length > 0) {
    const suffix = content.endsWith('\n') || content === '' ? '' : '\n';
    const newContent = content + suffix + missingEntries.join('\n') + '\n';
    await writeFile(gitignorePath, newContent);
  }
}
