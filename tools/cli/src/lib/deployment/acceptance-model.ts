import { z } from 'zod';

import { gitSha, sha, slug } from '../config/releases/model';
import {
  applicationLedgerSchema,
  privateLedgerSchema,
  publicLedgerSchema,
} from './migration-model';
import { runtimeImageSchema } from './runtime-model';

export const acceptanceVersionSchema = z
  .string()
  .max(64)
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/);
export const acceptanceServingSchema = z.strictObject({
  status: z.literal('ok'),
  version: acceptanceVersionSchema,
});
export const deploymentAcceptanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-deployment-acceptance'),
  name: slug,
  revision: gitSha,
  cliRevision: gitSha,
  deploymentRef: gitSha,
  bundleSha256: sha,
  readyReceiptSha256: sha,
  observedAt: z.iso.datetime(),
  version: acceptanceVersionSchema,
  images: z.array(runtimeImageSchema).min(8).max(20),
  serving: acceptanceServingSchema,
  migrations: z.tuple([
    applicationLedgerSchema.extend({ inventorySha256: sha }),
    privateLedgerSchema.extend({ inventorySha256: sha }),
    publicLedgerSchema.extend({ inventorySha256: sha }),
  ]),
});
