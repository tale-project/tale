import { z } from 'zod';

import { gitSha, sha, slug } from '../config/releases/model';
import { nativeOriginSchema } from './native-client';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const observationIdentitySchema = z.strictObject({
  name: slug,
  origin: nativeOriginSchema,
  organizationId: identifier,
  organizationSlug: slug,
  organizationName: z.string().min(1).max(200),
  userId: identifier,
});
export const nativeObservationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cliRevision: gitSha,
  cliSha256: sha,
  budgetMs: z.number().int().min(6000).max(45_000).default(45_000),
  target: observationIdentitySchema,
  operator: z.strictObject({
    email: z.email().max(254),
    password: z.string().min(1).max(4096),
  }),
});
export const observationEnvironmentSchema = z.strictObject({
  environment: z
    .record(
      z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      z
        .string()
        .max(8192)
        .refine((value) => Buffer.byteLength(value) <= 8192),
    )
    .refine((value) => Object.keys(value).length <= 128),
});
export type NativeObservationInput = z.infer<
  typeof nativeObservationInputSchema
>;
export const retainedReceiptSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    target: z.object({
      origin: nativeOriginSchema,
      orgId: identifier,
      projectId: identifier,
      automationName: slug,
    }),
    sourceCommit: gitSha.optional(),
    releaseRef: gitSha.optional(),
    configVersion: z.string().min(1).max(100).optional(),
    artifactSha256: sha,
    automationVersion: z.number().int().positive().safe(),
  })
  .refine((value) =>
    value.schemaVersion === 2
      ? value.releaseRef !== undefined &&
        value.releaseRef === value.sourceCommit &&
        value.configVersion === undefined
      : value.configVersion !== undefined && value.releaseRef === undefined,
  );
export const unavailableObservationSchema = z.strictObject({
  status: z.literal('unavailable'),
  reason: z.enum([
    'retained_state_missing',
    'retained_identity_missing',
    'retained_stage_missing',
    'retained_receipt_missing',
    'retained_owner_missing',
    'native_owner_unavailable',
  ]),
});
export const nativeObservationResultSchema = z.discriminatedUnion('status', [
  unavailableObservationSchema,
  z.strictObject({
    status: z.literal('observed'),
    identity: observationIdentitySchema,
    configurations: z
      .array(
        z.strictObject({
          clientId: slug,
          automationName: slug,
          projectId: identifier,
          receiptSha256: sha,
          stageSha256: sha,
          sourceCommit: gitSha,
          artifactSha256: sha,
          automationVersion: z.number().int().positive().safe(),
          workflowSha256: sha,
          skillInventorySha256: sha,
          ownedSkillFiles: z.number().int().nonnegative().safe(),
          custodyOwnerUserId: identifier.nullable(),
          skillOwners: z
            .array(
              z.strictObject({ slug, liveOwnerUserId: identifier.nullable() }),
            )
            .max(1024),
        }),
      )
      .max(64),
    claim: z.literal(
      'Retained artifact, current native version and owned asset bytes verified; no deployment or cutover authorization.',
    ),
  }),
]);
