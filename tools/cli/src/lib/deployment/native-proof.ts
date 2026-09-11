import { z } from 'zod';

import { gitSha, sha, slug } from '../config/releases/model';
import { emailAttestationProofSchema } from './email-attestation';

/** Public native proof shared by deployment admission and credential export.
 * Unknown response fields are stripped before any public receipt is emitted. */
export const nativeProvisionProofSchema = z.object({
  organizationId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\x00-\x1f\x7f]+(?![\s\S])/),
  organizationSlug: slug,
  userId: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\x00-\x1f\x7f]+(?![\s\S])/),
  ssoEnabled: z.boolean(),
  emailVerification: emailAttestationProofSchema.optional(),
  nativeClients: z
    .array(
      z.object({
        key: slug,
        clientId: z.string().min(1).max(256),
        changed: z.boolean(),
        credentials: z
          .strictObject({ path: z.string().max(1024), sha256: sha })
          .optional(),
      }),
    )
    .max(16),
  // Keep only public deployment proof, never arbitrary native response
  // fields that could accidentally carry a token or account secret.
  configs: z
    .array(
      z.object({
        clientId: slug,
        automationName: slug,
        releaseRef: gitSha,
        sourceCommit: gitSha,
        sourceRepository: z.string(),
        artifactSha256: sha,
        automationVersion: z.number().int().positive(),
        unchanged: z.boolean(),
        projectId: z.string().min(1).max(256),
        skillOwnerUserId: z.string().min(8).max(128).optional(),
        sourceCapsuleSha256: sha.optional(),
      }),
    )
    .max(64),
  // Parsed separately against the exact frozen model settings declaration.
  modelSettings: z.unknown().optional(),
});
