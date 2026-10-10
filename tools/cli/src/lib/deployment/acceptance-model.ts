import { z } from 'zod';

import { gitSha, sha, slug } from '../config/releases/model';
import {
  applicationLedgerSchema,
  privateLedgerSchema,
  publicLedgerSchema,
} from './migration-model';
import { deploymentSpecSchema } from './model';
import { runtimeImageSchema } from './runtime-model';

export const acceptanceVersionSchema = z
  .string()
  .max(64)
  .regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/);
export const servingProcessSchema = z.strictObject({
  service: z.string().regex(/^[a-z][a-z0-9-]{0,63}(?![\s\S])/),
  instance: z
    .string()
    .regex(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/,
    ),
});
export type ServingProcess = z.infer<typeof servingProcessSchema>;
const acceptanceServingSchema = z.strictObject({
  status: z.literal('ok'),
  version: acceptanceVersionSchema,
  origin: deploymentSpecSchema.shape.origin,
  originRoute: z
    .strictObject({
      kind: z.literal('container'),
      containerId: sha,
      networkId: sha,
      address: z.ipv4(),
    })
    .optional(),
  frontend: servingProcessSchema.extend({ service: z.literal('platform') }),
  backend: servingProcessSchema.extend({ service: z.literal('backend-api') }),
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
