import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { isValidSnapshotId } from '../backup/constants';
import { boundedJson } from './private-files';

/**
 * The journal of `tale runtime migrate` (design 14), `.tale/migration.json`:
 * the last step a migration from Docker to Incus finished, and what a
 * rollback needs to put Docker back. A migration that started and has not
 * ended (flipped, rolled back or finished) holds the workspace: a deploy or
 * a start on Docker would bring the stopped stack back beside it.
 */

/** The steps of `--to incus`, in order; a journal names the last done. */
export const MIGRATION_STEPS = [
  'started',
  'quiesced',
  'archived',
  'exported',
  'imported',
  'restored',
  'deployed',
  'checked',
  'flipped',
] as const;
export type MigrationStep = (typeof MIGRATION_STEPS)[number];

/** A migration that ended: rolled back to Docker, or finished on Incus. */
export const ENDED_STEPS = ['rolled-back', 'finished'] as const;

const colour = z.enum(['blue', 'green']);

export const migrationJournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  from: z.literal('docker'),
  to: z.literal('incus'),
  /** The version Docker ran and Incus deploys. */
  version: z.string().min(1).max(128),
  step: z.enum([...MIGRATION_STEPS, ...ENDED_STEPS]),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** The Docker snapshot the data travels in, once archived. */
  snapshot: z
    .string()
    .refine(isValidSnapshotId, 'Must be a snapshot id.')
    .nullable(),
  /** The export file, while it exists. */
  exportFile: z.string().min(1).max(4096).nullable(),
  /** Docker's deployment state, put back by a rollback. */
  docker: z.strictObject({
    colour: colour.nullable(),
    previousVersion: z.string().min(1).max(128).nullable(),
  }),
});
export type MigrationJournal = z.infer<typeof migrationJournalSchema>;

export function migrationJournalFile(deployDir: string): string {
  return join(deployDir, '.tale', 'migration.json');
}

/** The journal, or null when no migration was ever started. */
export async function readMigrationJournal(
  deployDir: string,
): Promise<MigrationJournal | null> {
  const file = migrationJournalFile(deployDir);
  if (!existsSync(file)) return null;
  const parsed = migrationJournalSchema.safeParse(await boundedJson(file));
  if (!parsed.success)
    throw preconditionError(
      `${file} is not a migration journal this CLI reads: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return parsed.data;
}

/**
 * Refuse `verb` while a migration from Docker to Incus is under way: the
 * Docker stack is stopped on purpose, and only `tale runtime migrate` may
 * go on or roll back.
 */
export async function assertNoMigrationUnderWay(
  deployDir: string,
  verb: string,
): Promise<void> {
  const journal = await readMigrationJournal(deployDir);
  if (
    journal === null ||
    journal.step === 'flipped' ||
    (ENDED_STEPS as readonly string[]).includes(journal.step)
  )
    return;
  throw preconditionError(
    `A migration of this workspace to Incus is under way (its last step: ${journal.step}); ${verb} would act on the Docker stack it stopped.`,
    [
      'tale runtime migrate --to incus    (go on with the migration)',
      'tale runtime migrate --to docker   (roll it back)',
    ],
  );
}
