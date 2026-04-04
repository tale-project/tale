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
import { generateAllRules } from '../rules/generators';

interface InitOptions {
  directory?: string;
  force?: boolean;
  noEnv?: boolean;
}

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

  // Create branding directory with empty config
  logger.step('Creating branding configuration...');
  await mkdir(join(target, 'branding', 'images'), { recursive: true });
  await writeFile(join(target, 'branding', 'branding.json'), '{}\n');
  await writeFile(join(target, 'branding', 'images', '.gitkeep'), '');

  // Copy provider configs (public JSON only, not encrypted secrets)
  logger.step('Copying provider configurations...');
  const providerFiles = getEmbeddedExamples('providers');
  const providerConfigFiles = new Map<string, string>();
  for (const [relPath, content] of providerFiles) {
    if (!relPath.endsWith('.secrets.json')) {
      providerConfigFiles.set(relPath, content);
    }
  }
  await writeEmbeddedFiles(providerConfigFiles, join(target, 'providers'));

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
  for (const [relPath, content] of providerConfigFiles) {
    allFiles.set(join('providers', relPath), computeContentHash(content));
  }
  allFiles.set(join('branding', 'branding.json'), computeContentHash('{}\n'));

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

  // Write AI rules files
  logger.step('Writing AI rules files...');
  const rulesFiles = generateAllRules();
  for (const { relativePath, content } of rulesFiles) {
    const destPath = join(target, relativePath);
    await mkdir(dirname(destPath), { recursive: true });
    await Bun.write(destPath, content);
  }

  // Ensure .gitignore
  await ensureGitignore(target);

  // .env setup
  if (!options.noEnv) {
    const { ensureEnv } = await import('../config/ensure-env');
    logger.blank();
    const envResult = await ensureEnv({ deployDir: target });

    // Generate encrypted provider secrets from the API key collected during env setup
    if (envResult.agePublicKey && envResult.openrouterKey) {
      const { sopsEncryptJson } = await import('../crypto/sops-encrypt');
      const encrypted = await sopsEncryptJson(
        { apiKey: envResult.openrouterKey },
        envResult.agePublicKey,
      );
      await writeFile(
        join(target, 'providers', 'openrouter.secrets.json'),
        encrypted,
      );
      logger.success(
        'Encrypted provider API key into providers/openrouter.secrets.json',
      );
    }
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
    ['Providers', `${providerConfigFiles.size} files`],
    ['Branding', '1 file'],
  ]);
  logger.blank();
  const needsCd = resolve(process.cwd()) !== resolve(target);
  let step = 1;

  logger.info('Next steps:');
  if (needsCd) {
    logger.info(`  ${step++}. Run "cd ${target}" to enter your project`);
  }
  logger.info(
    `  ${step++}. Edit agents/, workflows/, integrations/, and branding/ to customize your setup`,
  );
  logger.info(
    `  ${step++}. Open the project in an AI-powered editor (Claude Code, Cursor, Copilot, or Windsurf) for guided config creation`,
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
