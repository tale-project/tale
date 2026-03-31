import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import { computeContentHash, writeChecksums } from '../project/checksums';
import {
  fetchReference,
  getEmbeddedExamples,
} from '../project/fetch-reference';
import { CURRENT_PROJECT_VERSION, type Checksums } from '../project/types';

interface InitOptions {
  directory?: string;
  force?: boolean;
  noEnv?: boolean;
}

const CLAUDE_MD_CONTENT = `# Tale Project

This is a Tale project. Editable configs are in \`agents/\`, \`workflows/\`, and \`integrations/\`.

## Key reference code (read-only, for understanding schemas and constraints)

- \`.tale/reference/lib/shared/schemas/agents.ts\` — Agent JSON schema (Zod). Defines all valid fields for agent configs.
- \`.tale/reference/lib/shared/schemas/workflows.ts\` — Workflow JSON schema (Zod). Defines step types, config structure.
- \`.tale/reference/lib/shared/schemas/integrations.ts\` — Integration JSON schema (Zod). Defines config.json structure, auth methods, operations.
- \`.tale/reference/convex/agents/file_actions.ts\` — How agent files are read/written. Naming rules, validation.
- \`.tale/reference/convex/workflows/file_actions.ts\` — How workflow files are read/written. Slug format, history.
- \`.tale/reference/convex/integrations/file_actions.ts\` — How integration files are read/written. Directory structure, validation.

## Editing rules

- Agent filenames must match: \`[a-z0-9][a-z0-9_-]*\\.json\`
- Workflow files are organized by category in subdirectories
- Each integration is a directory containing: \`config.json\` (metadata + operations), \`connector.ts\` (runtime code), \`icon.svg\` (UI icon)
- Integration directory names must be lowercase alphanumeric with hyphens/underscores
- Refer to the Zod schemas for valid field values and constraints
`;

const GITIGNORE_ENTRIES = ['.tale/', '.env', '.history/'];

export async function init(options: InitOptions): Promise<void> {
  if (!options.directory && process.stdin.isTTY && process.stdout.isTTY) {
    const { input } = await import('@inquirer/prompts');
    const projectName = await input({
      message: 'Project name:',
      default: 'my-tale-project',
      validate: (value) => {
        if (!value.trim()) return 'Project name cannot be empty';
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(value.trim())) {
          return 'Use lowercase letters, numbers, hyphens, and underscores only';
        }
        return true;
      },
    });
    options.directory = join(process.cwd(), projectName.trim());
  }

  const target = resolve(options.directory ?? process.cwd());
  const taleJsonPath = join(target, 'tale.json');

  logger.header('Initializing Tale Project');

  // Check for existing project
  if (existsSync(taleJsonPath) && !options.force) {
    throw new Error(
      `tale.json already exists in ${target}. Use --force to overwrite.`,
    );
  }

  logger.info(`Project directory: ${target}`);

  // Ensure target directory exists
  await mkdir(target, { recursive: true });

  // Fetch reference code
  logger.step('Copying reference code to .tale/reference/...');
  await mkdir(join(target, '.tale'), { recursive: true });
  await fetchReference(target);

  // Copy agents from embedded examples
  logger.step('Copying agent configurations...');
  const agentFiles = getEmbeddedExamples('agents');
  await writeEmbeddedFiles(agentFiles, join(target, 'agents'));

  // Copy workflows from embedded examples
  logger.step('Copying workflow configurations...');
  const workflowFiles = getEmbeddedExamples('workflows');
  await writeEmbeddedFiles(workflowFiles, join(target, 'workflows'));

  // Copy integrations from embedded examples
  logger.step('Copying integration configurations...');
  const integrationFiles = getEmbeddedExamples('integrations');
  await writeEmbeddedFiles(integrationFiles, join(target, 'integrations'));

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
  const needsCd = resolve(process.cwd()) !== resolve(target);
  let step = 1;

  logger.info('Next steps:');
  if (needsCd) {
    logger.info(`  ${step++}. Run "cd ${target}" to enter your project`);
  }
  logger.info(
    `  ${step++}. Edit agents/, workflows/, and integrations/ to customize your setup`,
  );
  logger.info(`  ${step++}. Run "tale start" to launch the platform locally`);
}

async function writeEmbeddedFiles(
  files: Map<string, string>,
  destDir: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  for (const [relPath, content] of files) {
    const destPath = join(destDir, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, content);
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
