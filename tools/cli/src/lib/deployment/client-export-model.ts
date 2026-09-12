import { z } from 'zod';

import { gitSha, sha, slug } from '../config/releases/model';
import { emailAttestationProofSchema } from './email-attestation';
import {
  clientSchema,
  credentialSchema,
  identifier,
  nativeOriginSchema,
} from './native-client';

export const exportPrefixSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,59}(?![\s\S])/);
const provenance = z.strictObject({
  name: slug,
  bundleSha256: sha,
  readyReceiptSha256: sha,
  cliRevision: gitSha,
  runtimeRevision: gitSha,
  deploymentRef: gitSha.optional(),
});
/** Public selection sent privately to the backend; no unresolved credentials. */
export const clientExportTargetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  deployment: provenance,
  origin: nativeOriginSchema,
  organization: z.strictObject({
    id: identifier,
    slug: slug,
    name: z.string().min(1).max(200),
  }),
  userId: identifier,
  email: z.email().optional(),
  emailVerification: emailAttestationProofSchema.optional(),
  client: z.strictObject({
    key: clientSchema.shape.key,
    name: clientSchema.shape.name,
    redirectUris: clientSchema.shape.redirectUris,
    clientId: identifier,
    credentialsSha256: sha,
  }),
  envPrefix: exportPrefixSchema.optional(),
});
export type ClientExportTarget = z.infer<typeof clientExportTargetSchema>;
export const clientConsumerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-oidc-client'),
  deployment: provenance,
  issuer: z.string().url(),
  organizationId: identifier,
  organizationSlug: slug,
  clientKey: clientSchema.shape.key,
  clientId: credentialSchema.shape.clientId,
  clientSecret: credentialSchema.shape.clientSecret,
  redirectUris: clientSchema.shape.redirectUris,
});
export type ClientConsumer = z.infer<typeof clientConsumerSchema>;
export const clientExportReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-oidc-client-export'),
  phase: z.literal('ready'),
  target: clientExportTargetSchema,
  files: z
    .array(
      z.strictObject({
        path: z.enum(['client.json', 'consumer-env.json']),
        sha256: sha,
        bytes: z.number().int().positive().max(65536),
      }),
    )
    .min(1)
    .max(2),
});
export const clientExportResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  directory: z.string().min(1).max(4096),
  unchanged: z.boolean(),
  receipt: clientExportReceiptSchema,
  receiptFile: z.strictObject({
    path: z.literal('receipt.json'),
    sha256: sha,
    bytes: z.number().int().positive().max(65536),
  }),
});
export type ClientExportResult = z.infer<typeof clientExportResultSchema>;
export function consumerEnvironment(
  value: ClientConsumer,
  prefix: string,
): Record<string, string> {
  exportPrefixSchema.parse(prefix);
  return {
    [`${prefix}_ISSUER`]: value.issuer,
    [`${prefix}_CLIENT_ID`]: value.clientId,
    [`${prefix}_CLIENT_SECRET`]: value.clientSecret,
    [`${prefix}_ORG_SLUG`]: value.organizationSlug,
  };
}
