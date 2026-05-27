import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import { computeContentHash, writeChecksums } from '../project/checksums';
import {
  fetchReference,
  getEmbeddedExamples,
} from '../project/fetch-reference';
import { generateProjectId } from '../project/generate-project-id';
import { setProjectId } from '../project/project-context';
import { readProject } from '../project/read-project';
import {
  CURRENT_PROJECT_VERSION,
  type Checksums,
  type TaleProject,
} from '../project/types';
import { writeProject } from '../project/write-project';
import { generateAllRules } from '../rules/generators';

interface InitOptions {
  directory?: string;
  force?: boolean;
  noEnv?: boolean;
}

const GITIGNORE_ENTRIES = [
  '.tale/',
  '.env',
  // History dirs sit at any depth under the org-first tree
  // (e.g. `default/agents/.history/<slug>/`); use a recursive glob.
  '**/.history/',
  'compose.override.yml',
  'compose.override.yaml',
  // Provider API keys — SOPS-encrypted when SOPS_AGE_KEY is set, plaintext
  // otherwise. Both forms contain credentials and must never be committed.
  '**/*.secrets.json',
];

export async function init(options: InitOptions): Promise<void> {
  let directory = options.directory;
  let force = options.force ?? false;

  // Check if cwd is already a Tale project before prompting for project name
  const cwdTaleJson = join(process.cwd(), 'tale.json');
  if (!directory && existsSync(cwdTaleJson)) {
    if (!force) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { confirm } = await import('@inquirer/prompts');
        const shouldReinit = await confirm({
          message: 'This directory is already a Tale project. Reinitialize?',
          default: false,
        });
        if (!shouldReinit) {
          logger.info('Aborted.');
          return;
        }
      } else {
        throw new Error(
          `tale.json already exists in ${process.cwd()}. Use --force to overwrite.`,
        );
      }
    }
    directory = process.cwd();
    force = true;
  }

  if (!directory && process.stdin.isTTY && process.stdout.isTTY) {
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
    directory = join(process.cwd(), projectName.trim());
  }

  const target = resolve(directory ?? process.cwd());
  const taleJsonPath = join(target, 'tale.json');

  // Guard for explicit directory argument pointing to an existing project
  if (existsSync(taleJsonPath) && !force) {
    throw new Error(
      `tale.json already exists in ${target}. Use --force to overwrite.`,
    );
  }

  // Check if directory exists and contains Tale project files
  if (!force && existsSync(target)) {
    const hasTaleFiles = await detectTaleProjectFiles(target);
    if (hasTaleFiles.length > 0) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { confirm } = await import('@inquirer/prompts');
        logger.warn(
          `Directory "${target}" already contains Tale project files:`,
        );
        for (const file of hasTaleFiles) {
          logger.info(`  - ${file}`);
        }
        const shouldOverwrite = await confirm({
          message: 'Overwrite existing project files?',
          default: false,
        });
        if (!shouldOverwrite) {
          logger.info('Aborted.');
          return;
        }
      } else {
        throw new Error(
          `Directory "${target}" already contains Tale project files (${hasTaleFiles.join(', ')}). Use --force to overwrite.`,
        );
      }
    }
  }

  logger.header('Initializing Tale Project');

  logger.info(`Project directory: ${target}`);

  // Ensure target directory exists
  await mkdir(target, { recursive: true });

  // Fetch reference code
  logger.step('Copying reference code to .tale/reference/...');
  await mkdir(join(target, '.tale'), { recursive: true });
  await fetchReference(target);

  // Host workspace mirrors the uniform org-first layout: scaffold under
  // `default/<domain>/...`. The default org is the canonical template;
  // operators can add `<otherOrg>/<domain>/...` subtrees alongside and
  // `tale deploy --override` will push each `<org>` it finds at root.
  const defaultOrgDir = join(target, 'default');

  // Copy agents from embedded examples
  logger.step('Copying agent configurations...');
  const agentFiles = getEmbeddedExamples('agents');
  await writeEmbeddedFiles(agentFiles, join(defaultOrgDir, 'agents'));

  // Copy workflows from embedded examples
  logger.step('Copying workflow configurations...');
  const workflowFiles = getEmbeddedExamples('workflows');
  await writeEmbeddedFiles(workflowFiles, join(defaultOrgDir, 'workflows'));

  // Copy integrations from embedded examples
  logger.step('Copying integration configurations...');
  const integrationFiles = getEmbeddedExamples('integrations');
  await writeEmbeddedFiles(
    integrationFiles,
    join(defaultOrgDir, 'integrations'),
  );

  // Create branding directory with empty config
  logger.step('Creating branding configuration...');
  await mkdir(join(defaultOrgDir, 'branding', 'images'), { recursive: true });
  await writeFile(join(defaultOrgDir, 'branding', 'branding.json'), '{}\n');
  await writeFile(join(defaultOrgDir, 'branding', 'images', '.gitkeep'), '');

  // Copy provider configs (public JSON only, not encrypted secrets)
  logger.step('Copying provider configurations...');
  const providerFiles = getEmbeddedExamples('providers');
  const providerConfigFiles = new Map<string, string>();
  for (const [relPath, content] of providerFiles) {
    if (!relPath.endsWith('.secrets.json')) {
      providerConfigFiles.set(relPath, content);
    }
  }
  await writeEmbeddedFiles(
    providerConfigFiles,
    join(defaultOrgDir, 'providers'),
  );

  // Copy skills from embedded examples
  logger.step('Copying skill bundles...');
  const skillFiles = getEmbeddedExamples('skills');
  await writeEmbeddedFiles(skillFiles, join(defaultOrgDir, 'skills'));

  // Compute checksums. Paths are recorded relative to the project root,
  // matching where the files actually live (default/<domain>/...).
  logger.step('Computing file checksums...');
  const allFiles = new Map<string, string>();

  for (const [relPath, content] of agentFiles) {
    allFiles.set(
      join('default', 'agents', relPath),
      computeContentHash(content),
    );
  }
  for (const [relPath, content] of workflowFiles) {
    allFiles.set(
      join('default', 'workflows', relPath),
      computeContentHash(content),
    );
  }
  for (const [relPath, content] of integrationFiles) {
    allFiles.set(
      join('default', 'integrations', relPath),
      computeContentHash(content),
    );
  }
  for (const [relPath, content] of providerConfigFiles) {
    allFiles.set(
      join('default', 'providers', relPath),
      computeContentHash(content),
    );
  }
  for (const [relPath, content] of skillFiles) {
    allFiles.set(
      join('default', 'skills', relPath),
      computeContentHash(content),
    );
  }
  allFiles.set(
    join('default', 'branding', 'branding.json'),
    computeContentHash('{}\n'),
  );

  const checksums: Checksums = {
    cliVersion: pkg.version,
    files: Object.fromEntries(allFiles),
  };
  await writeChecksums(target, checksums);

  // Write tale.json. On reinit, preserve the existing project id and
  // createdAt so Docker volumes/containers keyed on the id remain valid.
  logger.step('Writing tale.json...');
  let existingProject: TaleProject | null = null;
  if (existsSync(taleJsonPath)) {
    try {
      existingProject = await readProject(target);
    } catch (err) {
      logger.debug(`Could not read existing tale.json: ${err}`);
    }
  }
  const projectId = existingProject?.id ?? generateProjectId(basename(target));
  const project: TaleProject = {
    version: CURRENT_PROJECT_VERSION,
    cliVersion: pkg.version,
    createdAt: existingProject?.createdAt ?? new Date().toISOString(),
    id: projectId,
  };
  await writeProject(taleJsonPath, project);

  // Make the ID available to subsequent steps (ensureEnv uses getProjectId()).
  setProjectId(projectId);

  // (`.tale/migrations.json` seeding removed alongside the auto-migration
  // framework. Existing projects' stale files are harmless and can be
  // deleted manually.)

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

    // Persist the OpenRouter API key collected during env setup as a SOPS-
    // encrypted file. `ensureEnv` always provisions a SOPS age keypair at
    // init time, so `agePublicKey` is invariably present here. Operators who
    // want plaintext-mode storage do so by clearing `SOPS_AGE_KEY` in .env
    // after init and re-saving keys via Settings → AI providers; the
    // encrypted-vs-plaintext mode is a runtime save-path decision, not an
    // init-time choice.
    if (envResult.openrouterKey && envResult.agePublicKey) {
      const secretsPath = join(
        target,
        'default',
        'providers',
        'openrouter.secrets.json',
      );
      const { sopsEncryptJson } = await import('../crypto/sops-encrypt');
      const encrypted = await sopsEncryptJson(
        { apiKey: envResult.openrouterKey },
        envResult.agePublicKey,
      );
      // 0600: SOPS-encrypted, but least-privilege convention for any
      // `*.secrets.*` file. Limits readability to the owner.
      await writeFile(secretsPath, encrypted, { mode: 0o600 });
      logger.success(
        'Encrypted provider API key into default/providers/openrouter.secrets.json',
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
    ['Skills', `${skillFiles.size} files`],
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
    `  ${step++}. Edit default/agents/, default/workflows/, default/integrations/, default/skills/, and default/branding/ to customize your setup`,
  );
  logger.info(
    `  ${step++}. Open the project in an AI-powered editor (Claude Code, Cursor, Copilot, or Windsurf) for guided config creation`,
  );
  logger.info(`  ${step++}. Run "tale start" to launch the platform locally`);
}

// Top-level markers indicating a Tale project. Under the uniform org-first
// layout, `default/` is the canonical org dir (and any other org dir is
// also a marker, but we don't try to enumerate slugs — `default/` is enough
// to detect a project). Legacy per-domain dirs (`agents/`, `workflows/`,
// etc.) at the root are kept as markers so `tale init` re-detects old
// projects from a prior CLI version.
const TALE_PROJECT_MARKERS = new Set([
  '.env',
  'tale.json',
  '.tale',
  'default',
  // Legacy / pre-org-first markers (detected during reinit only):
  'providers',
  'agents',
  'workflows',
  'integrations',
  'skills',
  'branding',
]);

async function detectTaleProjectFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => TALE_PROJECT_MARKERS.has(entry));
  } catch (err: unknown) {
    // Most common case: target dir does not exist yet (`tale init` in a
    // fresh empty dir, or a path the operator just typed). Treat as
    // empty — non-ENOENT errors are worth a warning so a perms issue
    // doesn't masquerade as a clean slate.
    const code =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      typeof err.code === 'string'
        ? err.code
        : undefined;
    if (code !== 'ENOENT') {
      console.warn(`[init.detectTaleProjectFiles] readdir ${dir} failed:`, err);
    }
    return [];
  }
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
