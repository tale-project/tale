import { z } from 'zod';

const ordered = (item: z.ZodString) =>
  z
    .array(item)
    .min(1)
    .max(2048)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || ids[index - 1] < id),
      'Migration identities must be unique and sorted.',
    );

const applicationMigrationSchema = z
  .string()
  .max(200)
  .regex(/^[0-9]{4}_[a-z0-9_]+\.(?:sql|ts)$/);
const knowledgeMigrationSchema = z.string().regex(/^[1-9][0-9]{0,13}$/);

export const applicationLedgerSchema = z.strictObject({
  service: z.literal('db'),
  schema: z.literal('public'),
  table: z.literal('app_migrations'),
  ids: ordered(applicationMigrationSchema),
});
export const privateLedgerSchema = z.strictObject({
  service: z.literal('knowledge-db'),
  schema: z.literal('private_knowledge'),
  table: z.literal('schema_migrations'),
  ids: ordered(knowledgeMigrationSchema),
});
export const publicLedgerSchema = z.strictObject({
  service: z.literal('knowledge-db'),
  schema: z.literal('public_web'),
  table: z.literal('schema_migrations'),
  ids: ordered(knowledgeMigrationSchema),
});

/** Every required ledger, rather than a guessed latest migration or count. */
export const migrationInventorySchema = z.tuple([
  applicationLedgerSchema,
  privateLedgerSchema,
  publicLedgerSchema,
]);
export type MigrationInventory = z.infer<typeof migrationInventorySchema>;
