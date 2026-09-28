import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionType, NodePlopAPI } from 'plop';

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, '../templates/migration');
const repoRoot = path.resolve(here, '../../..');
const MIGRATIONS_REL = 'services/platform/backend/db/migrations';
const migrationsDir = path.join(repoRoot, MIGRATIONS_REL);

/** `sql`: a schema change, or a backfill SQL can decide alone. `ts`: a data
 * migration that decides with the app's own code — the migrator imports it
 * and calls its `migrate(tx)` (`backend/db/migrate.ts`). */
type MigrationKind = 'sql' | 'ts';

interface Answers {
  slug: string;
  subject: string;
  /** Absent from a scripted caller: the SQL kind. */
  kind?: MigrationKind;
}

const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * The next contiguous 4-digit prefix — never prompted. Filename order IS
 * apply order and the filename is the identity in `app_migrations`, so a
 * hand-picked number that collides (or leaves a gap someone later fills)
 * changes the order a deployment applies things in.
 */
function nextNumber(): number {
  if (!existsSync(migrationsDir)) return 1;
  let max = 0;
  for (const entry of readdirSync(migrationsDir)) {
    const match = /^(\d{4})_/.exec(entry);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max + 1;
}

function nextSteps(file: string, kind: MigrationKind): string {
  if (kind === 'ts') {
    return (
      `\nScaffolded ${file}.\n\n` +
      `Next steps:\n` +
      `  1. say WHY at the top: which rows it fills, and which rule of the\n` +
      `     app's own code decides them — never a SQL copy of that rule\n` +
      `  2. read only the rows that can need the fill (FOR UPDATE), decide\n` +
      `     them with that rule, and write set-based, re-checking the\n` +
      `     condition in the UPDATE, so a second run changes nothing\n` +
      `  3. keep it rolling-deploy safe: the PREVIOUS image is still serving\n` +
      `     while this applies\n` +
      `  4. pin its decision table in backend/db/data-migrations.test.ts, and\n` +
      `     seed the rows, run migrate twice, in backend/integration-check.ts\n` +
      `  5. bun run --filter @tale/platform backend:integration (see\n` +
      `     backend/README.md for the throwaway Postgres + MinIO invocation)`
    );
  }
  return (
    `\nScaffolded ${file}.\n\n` +
    `Next steps:\n` +
    `  1. write the DDL — one subject per file, everything in the \`app\`\n` +
    `     schema, and say WHY at the top (these files are the schema's docs)\n` +
    `  2. keep it rolling-deploy safe: the PREVIOUS image is still serving\n` +
    `     while this applies, so no bare NOT NULL on a populated table, no\n` +
    `     constraint existing rows fail, no column drop before the code that\n` +
    `     reads it has shipped\n` +
    `  3. encode the rule in the schema where you can (a partial unique index\n` +
    `     is a rule the database cannot forget)\n` +
    `  4. add a probe to backend/integration-check.ts for what it enables\n` +
    `  5. bun run --filter @tale/platform backend:integration (see\n` +
    `     backend/README.md for the throwaway Postgres + MinIO invocation)`
  );
}

export function registerMigration(plop: NodePlopAPI): void {
  plop.setGenerator('migration', {
    description: `Backend database migration (${MIGRATIONS_REL}) — one numbered .sql file, or a .ts data migration, applied at boot`,
    prompts: [
      {
        type: 'list',
        name: 'kind',
        message: 'Kind:',
        choices: [
          {
            name: 'sql — a schema change, or a backfill SQL can decide alone',
            value: 'sql',
          },
          {
            name: "ts — a data migration that decides with the app's own code",
            value: 'ts',
          },
        ],
        default: 'sql',
      },
      {
        type: 'input',
        name: 'slug',
        message: 'Slug (snake_case, e.g. competence_records):',
        validate: (v: string) =>
          SLUG_RE.test(v) || 'Use lowercase snake_case, no leading underscore',
      },
      {
        type: 'input',
        name: 'subject',
        message: 'What is this for? (one line, becomes the header comment):',
        validate: (v: string) =>
          v.trim().length >= 10 ||
          'At least 10 characters — say what it is for',
      },
    ],
    actions: (data) => {
      const answers = data as Answers;
      const kind: MigrationKind = answers.kind === 'ts' ? 'ts' : 'sql';
      const nnnn = String(nextNumber()).padStart(4, '0');
      const fileName = `${nnnn}_${answers.slug}.${kind}`;
      const dest = `${MIGRATIONS_REL}/${fileName}`;

      const actions: ActionType[] = [
        {
          type: 'add',
          path: path.join(repoRoot, dest),
          templateFile: `${templateDir}/migration.${kind}.hbs`,
          data: { ...answers, fileName },
        },
      ];
      actions.push(() => nextSteps(dest, kind));
      return actions;
    },
  });
}
