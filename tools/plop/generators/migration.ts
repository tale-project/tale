import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/migration');
const repoRoot = path.resolve(here, '../../..');
const versionsRoot = path.join(
  repoRoot,
  'services/platform/convex/migrations/versions',
);

type MigrationKind = 'db' | 'node' | 'component' | 'reference';

interface Answers {
  version: string;
  slug: string;
  kind: MigrationKind;
  title: string;
  description: string;
  destructive: boolean;
  table?: string;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** The release the migration ships in — default the version being developed. */
function defaultVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ) as { version?: string };
    return typeof pkg.version === 'string' && SEMVER_RE.test(pkg.version)
      ? pkg.version
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Next contiguous NN inside the version folder — never prompted. */
function nextNumericId(versionDir: string): number {
  if (!existsSync(versionDir)) return 1;
  let max = 0;
  for (const entry of readdirSync(versionDir)) {
    const match = /^(\d{2})_/.exec(entry);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max + 1;
}

/** The kind's rollback backup strategy when `up` destroys data. */
function snapshotFor(kind: MigrationKind, destructive: boolean): string {
  if (!destructive || kind === 'reference') return 'none';
  return kind === 'node' ? 'fs-tree' : 'table-rows';
}

function nextSteps(id: string, folder: string): string {
  return (
    `\nScaffolded ${folder} (id ${id}) and refreshed the generated registries.\n\n` +
    `Next steps:\n` +
    `  1. implement up/down in migration.ts — both IDEMPOTENT, both total\n` +
    `  2. declare accurate subjects (every table/domain the handlers touch);\n` +
    `     if a subject is new, extend the baseline world corpus\n` +
    `     (convex/migrations/testing/world/) so the chain covers it\n` +
    `  3. fill in migration.test.ts (seed + expectUp; the harness runs the\n` +
    `     up/idempotency/down/digest ritual for you)\n` +
    `  4. bun run --filter @tale/platform migrations:check\n` +
    `  5. schema changed? run the snapshot ritual: data-safe growth ->\n` +
    `     \`migrations:snapshot\`; data-incompatible -> this migration must\n` +
    `     reshape the data FIRST (see .agents/skills/validate-configs)\n` +
    `  6. bunx vitest --run --project server convex/migrations (chain included)`
  );
}

export function registerMigration(plop: NodePlopAPI): void {
  plop.setGenerator('migration', {
    description:
      'Versioned data migration (services/platform/convex/migrations/versions) — db, node, component, or reference',
    prompts: [
      {
        type: 'input',
        name: 'version',
        message: 'Release semver the migration ships in:',
        default: defaultVersion(),
        validate: (v: string) =>
          SEMVER_RE.test(v) || 'Use plain major.minor.patch (e.g. 0.3.5)',
      },
      {
        type: 'input',
        name: 'slug',
        message: 'Slug (snake_case, e.g. backfill_contacts_from_vendors):',
        validate: (v: string) =>
          SLUG_RE.test(v) || 'Use lowercase snake_case, no leading underscore',
      },
      {
        type: 'list',
        name: 'kind',
        message: 'Kind:',
        choices: [
          {
            name: 'db — batched per-row transform over one table',
            value: 'db',
          },
          {
            name: 'node — per-organization, touches org-config files',
            value: 'node',
          },
          {
            name: 'component — batched over Better Auth component tables',
            value: 'component',
          },
          {
            name: 'reference — documents an already-shipped change (never runs)',
            value: 'reference',
          },
        ],
        default: 'db',
      },
      {
        type: 'input',
        name: 'title',
        message: 'Title (CLI listings, 1..100 chars):',
        validate: (v: string) =>
          (v.length > 0 && v.length <= 100) || 'Between 1 and 100 characters',
      },
      {
        type: 'input',
        name: 'description',
        message:
          'Description (what up does + how down reverses it, ≥40 chars):',
        validate: (v: string) =>
          v.length >= 40 || 'At least 40 characters — say up AND down',
      },
      {
        type: 'confirm',
        name: 'destructive',
        message: 'Destructive (up removes/overwrites data)?',
        default: false,
      },
      {
        type: 'input',
        name: 'table',
        message:
          'Table the runner paginates (db/reference; ignored otherwise):',
        default: 'REPLACE_ME',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const versionDirName = `v${answers.version.replaceAll('.', '_')}`;
      const versionDir = path.join(versionsRoot, versionDirName);
      const numericId = nextNumericId(versionDir);
      const nn = String(numericId).padStart(2, '0');
      const folderName = `${nn}_${answers.slug}`;
      const id = `${answers.version}/${folderName}`;
      const dest = `services/platform/convex/migrations/versions/${versionDirName}/${folderName}`;

      const templateData = {
        ...answers,
        id,
        folderName,
        versionDirName,
        snapshot: snapshotFor(answers.kind, answers.destructive),
      };

      const actions: ActionType[] = [
        {
          type: 'add',
          path: `${dest}/migration.ts`,
          templateFile: `${templateDir}/${answers.kind}/migration.ts.hbs`,
          data: templateData,
        },
        {
          type: 'add',
          path: `${dest}/migration.test.ts`,
          templateFile: `${templateDir}/${answers.kind}/migration.test.ts.hbs`,
          data: templateData,
        },
      ];

      // Regenerate the registries so the scaffold is registered (and the
      // folder-shape validation runs) before the author writes a line.
      actions.push(() => {
        execSync('bun run --filter @tale/platform migrations:sync', {
          cwd: repoRoot,
          stdio: 'pipe',
        });
        return 'migrations:sync — generated registries refreshed';
      });
      actions.push(() => nextSteps(id, dest));
      return actions;
    },
  });
}
