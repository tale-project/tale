import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import pkg from '../../../package.json';
import * as logger from '../../utils/logger';
import {
  countAutoInstall,
  countTopLevelEntries,
} from '../project/catalog-counts';
import { computeContentHash, writeChecksums } from '../project/checksums';
import {
  DEFAULT_README_CONTENT,
  DEFAULT_README_RELPATH,
} from '../project/default-readme';
import {
  fetchReference,
  getEmbeddedExamples,
} from '../project/fetch-reference';
import { generateProjectId } from '../project/generate-project-id';
import { SCAFFOLD_DOMAINS } from '../project/org-dirs';
import { setProjectId } from '../project/project-context';
import { readProject } from '../project/read-project';
import {
  CURRENT_PROJECT_VERSION,
  type Checksums,
  type TaleProject,
} from '../project/types';
import { writeProject } from '../project/write-project';
import { writeAgentInstructions } from '../rules/generators';

interface InitOptions {
  directory?: string;
  force?: boolean;
  noEnv?: boolean;
}

/**
 * Distinguishes "the user aborted" from "we initialized" so callers don't
 * print success guidance after an abort. `directory` is the resolved project
 * directory the scaffold was written to.
 */
type InitResult =
  | { status: 'aborted' }
  | { status: 'initialized'; directory: string };

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

export async function init(options: InitOptions): Promise<InitResult> {
  let directory = options.directory;
  let force = options.force ?? false;

  // Check if cwd is already a Tale project before prompting for project name
  const cwdTaleJson = join(process.cwd(), 'tale.json');
  if (!directory && existsSync(cwdTaleJson)) {
    if (!force) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { confirm } = await import('../../utils/prompt');
        const shouldReinit = await confirm({
          message: 'This directory is already a Tale project. Reinitialize?',
          default: false,
        });
        if (!shouldReinit) {
          logger.info('Aborted.');
          return { status: 'aborted' };
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
    const { input } = await import('../../utils/prompt');
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
        const { confirm } = await import('../../utils/prompt');
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
          return { status: 'aborted' };
        }
      } else {
        throw new Error(
          `Directory "${target}" already contains Tale project files (${hasTaleFiles.join(', ')}). Use --force to overwrite.`,
        );
      }
    }
  }

  logger.header('Initializing Tale');

  logger.info(`Project directory: ${target}`);

  // Ensure target directory exists
  await mkdir(target, { recursive: true });

  // Fetch reference code
  logger.step('Copying reference code...');
  await mkdir(join(target, '.tale'), { recursive: true });
  // Real organizations (created in-app) are runtime data and live here, kept
  // out of the committed `default/` template. Created up front so the
  // location is discoverable and so `tale deploy` has a stable sync target.
  await mkdir(join(target, '.tale', 'orgs'), { recursive: true });
  await fetchReference(target);

  // Host workspace mirrors the uniform org-first layout: scaffold the
  // committed `default/<domain>/...` template at the project root. `default`
  // is the canonical seed for every new organization — never a deployable
  // org itself. Real organizations are created in-app and live as runtime
  // data under `.tale/orgs/<orgSlug>/<domain>/`, which `tale deploy
  // --override` pushes.
  const defaultOrgDir = join(target, 'default');

  // Copy the branding config from the embedded example (fall back to an empty
  // object). Written directly rather than through writeEmbeddedFiles so this
  // single root-level file always lands cross-platform (a Map-iteration copy
  // dropped it on Windows). Keep an images/ dir for uploaded assets.
  logger.step('Copying branding configuration...');
  const brandingJson =
    getEmbeddedExamples('branding').get('branding.json') ?? '{}\n';
  await mkdir(join(defaultOrgDir, 'branding', 'images'), { recursive: true });
  await writeFile(
    join(defaultOrgDir, 'branding', 'branding.json'),
    brandingJson,
  );
  await writeFile(join(defaultOrgDir, 'branding', 'images', '.gitkeep'), '');

  // Every other embedded catalog domain (agents, automations, governance,
  // skills — see SCAFFOLD_DOMAINS), public files only: encrypted
  // *.secrets.json sidecars are never scaffolded.
  for (const domain of SCAFFOLD_DOMAINS) {
    if (domain === 'branding') continue;
    logger.step(`Copying ${domain} configurations...`);
    await writeEmbeddedFiles(
      withoutSecrets(getEmbeddedExamples(domain)),
      join(defaultOrgDir, domain),
    );
  }

  // Explain the tree it sits in: most of `default/` is a passive catalog
  // (only `metadata.autoInstall: true` entries are active on a new org),
  // which nothing on disk would otherwise say.
  logger.step('Writing default/README.md...');
  await writeFile(join(target, DEFAULT_README_RELPATH), DEFAULT_README_CONTENT);

  // Write the agent instructions (AGENTS.md + CLAUDE.md). Kept ABOVE the
  // checksum step so their hashes land in `.tale/checksums.json`: without that,
  // `tale update`'s `!oldHash` "new" branch (update.ts:95-101) would
  // unconditionally overwrite on the first update after init and clobber local
  // edits (round-2 P1-34). `writeAgentInstructions` merges into any existing
  // files through a managed marker block, so it returns the final written
  // content to hash.
  logger.step('Writing agent instructions (AGENTS.md, CLAUDE.md)...');
  const rulesFiles = await writeAgentInstructions(target);

  // Compute checksums. Paths are recorded relative to the project root,
  // matching where the files actually live (default/<domain>/... and
  // the rules files at the project root).
  logger.step('Computing file checksums...');
  const allFiles = new Map<string, string>();

  for (const { relativePath, content } of rulesFiles) {
    allFiles.set(relativePath, computeContentHash(content));
  }
  for (const domain of SCAFFOLD_DOMAINS) {
    if (domain === 'branding') continue;
    for (const [relPath, content] of withoutSecrets(
      getEmbeddedExamples(domain),
    )) {
      allFiles.set(
        join('default', domain, relPath),
        computeContentHash(content),
      );
    }
  }
  allFiles.set(
    join('default', 'branding', 'branding.json'),
    computeContentHash(brandingJson),
  );
  allFiles.set(
    DEFAULT_README_RELPATH,
    computeContentHash(DEFAULT_README_CONTENT),
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
      logger.debug(`Could not read existing tale.json: ${String(err)}`);
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

  // (AI rules files are now written ABOVE the checksum step — see the
  // `generateAllRules()` block earlier so their hashes are recorded.)

  // Ensure .gitignore
  await ensureGitignore(target);

  // .env setup — local defaults (production domain/TLS is chosen at deploy).
  if (!options.noEnv) {
    const { ensureEnv, setEnvVars } = await import('../config/ensure-env');
    await ensureEnv({ deployDir: target });

    // Offer docker-in-sandbox (lets agents run `docker` / `docker compose`).
    // Off unless asked: on the default `runc` runtime it means a PRIVILEGED
    // inner daemon (in-container root = host root) — fine for a single-user /
    // trusted install, but not something to enable silently for a multi-tenant
    // operator. Sysbox/kata get it automatically (the spawner's tier-aware
    // default), so this prompt is really the runc opt-in.
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const { confirm } = await import('../../utils/prompt');
      const enableDocker = await confirm({
        message:
          'Let agents run docker / docker compose inside sandboxes? ' +
          '(single-user: yes — runs a privileged inner Docker; ' +
          'untrusted multi-tenant: install Sysbox instead)',
        default: false,
      });
      if (enableDocker) {
        await setEnvVars(target, { SANDBOX_DOCKER_IN_CONTAINER: 'true' });
        logger.info(
          '  Enabled docker-in-sandbox (SANDBOX_DOCKER_IN_CONTAINER=true).',
        );
      }
    }
  }

  logger.blank();
  logger.success('Tale project initialized!');
  logger.blank();
  // Honest inventory: a file on disk is a catalog entry, not an active
  // install (default/README.md explains the split). Agents split by
  // `metadata.autoInstall`; skills are bundles of several files each, so
  // count entries rather than files.
  const agentCounts = countAutoInstall(getEmbeddedExamples('agents'));
  logger.table([
    ['Project', target],
    ['CLI version', pkg.version],
    [
      'Agents',
      `${agentCounts.active} active, ${agentCounts.catalog} in catalog`,
    ],
    [
      'Automations',
      `${withoutSecrets(getEmbeddedExamples('automations')).size} available`,
    ],
    [
      'Governance',
      `${withoutSecrets(getEmbeddedExamples('governance')).size} files`,
    ],
    [
      'Skills',
      `${countTopLevelEntries(getEmbeddedExamples('skills'))} available`,
    ],
    ['Branding', '1 file'],
  ]);
  logger.blank();
  const needsCd = resolve(process.cwd()) !== resolve(target);
  const relTarget = relative(process.cwd(), target) || '.';
  let step = 1;

  logger.info('Next steps:');
  if (needsCd) {
    logger.info(`  ${step++}. cd ${relTarget}`);
  }
  logger.info(`  ${step++}. tale dev    (launch locally)`);
  logger.info(
    `  ${step++}. Open the app, create the owner account, then add your`,
  );
  logger.info('       OpenRouter key when the setup wizard asks — or later in');
  logger.info(
    '       Settings → AI providers. Get a key: https://openrouter.ai/keys',
  );
  logger.info(`  ${step++}. tale deploy   (when ready, deploy to your domain)`);
  logger.blank();
  logger.notice(
    'Production-ready by default: every secret — including the audit-log ' +
      'signing key — is auto-generated in .env. Nothing to hand-edit; just ' +
      'back up .env so you can restore or redeploy.',
  );

  return { status: 'initialized', directory: target };
}

// Top-level markers indicating a Tale project. Under the uniform org-first
// layout, `default/` is the canonical org dir (and any other org dir is
// also a marker, but we don't try to enumerate slugs — `default/` is enough
// to detect a project).
const TALE_PROJECT_MARKERS = new Set(['.env', 'tale.json', '.tale', 'default']);

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
      logger.debug(
        `detectTaleProjectFiles: readdir ${dir} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [];
  }
}

/** Drop encrypted `*.secrets.json` sidecars from an embedded file set. */
function withoutSecrets(files: Map<string, string>): Map<string, string> {
  const publicFiles = new Map<string, string>();
  for (const [relPath, content] of files) {
    if (!relPath.endsWith('.secrets.json')) publicFiles.set(relPath, content);
  }
  return publicFiles;
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
