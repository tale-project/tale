import { z } from 'zod';

/**
 * The wire shapes of the conversations mirror (`/api/v1/conversations/*`),
 * shared by the door, the domain and the OpenAPI source. Every object is
 * strict: a key the schema does not name is refused (400 `INVALID_BODY`
 * naming it), never dropped — a typo in an integration's field name must
 * not read as success.
 */

/** A source slug — the pattern the door enforces on the query string and
 * on every body that names a source; the OpenAPI source renders it. */
export const API_SOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,59}$/;
export const apiSourceSchema = z.string().regex(API_SOURCE_PATTERN);

/** A source's own identifier for a conversation, message, contact or
 * attachment: 1..256 characters, opaque. */
export const API_EXTERNAL_ID_MAX_LENGTH = 256;
export const apiExternalIdSchema = z
  .string()
  .min(1)
  .max(API_EXTERNAL_ID_MAX_LENGTH);

export const apiDeliveryFailureSchema = z.strictObject({
  claimToken: z.uuid(),
  code: z.enum([
    'platform_unauthorized',
    'platform_forbidden',
    'platform_not_found',
    'platform_invalid_state',
    'platform_validation_failed',
    'platform_payload_too_large',
    'platform_unavailable',
    'tale_unavailable',
    'network_error',
    'contract_drift',
  ]),
  permanent: z.boolean(),
});
export const apiAttachmentSchema = z.strictObject({
  externalId: apiExternalIdSchema.optional(),
  storageId: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .min(0)
    .max(30 * 1024 * 1024),
});
export const replyConstraintsSchema = z.strictObject({
  minBodyChars: z.number().int().min(0).max(100).default(1),
  maxBodyChars: z.number().int().min(1).max(20_000).default(20_000),
  maxAttachments: z.number().int().min(0).max(10).default(10),
  maxAttachmentBytes: z
    .number()
    .int()
    .min(1)
    .max(30 * 1024 * 1024)
    .default(30 * 1024 * 1024),
  attachmentExtensions: z
    .array(z.string().regex(/^[a-z0-9]+$/))
    .max(100)
    .optional(),
});
/** One message of a snapshot. `taleMessageId` marks a message that began
 * life as a native Inbox reply (claimed through the deliveries lane): it
 * names that reply's `messageId`, and the reply must have been acknowledged
 * under this `externalId` first. A message without it is the source's own,
 * whatever `isCustomer` says. */
const apiSnapshotMessageSchema = z.strictObject({
  externalId: apiExternalIdSchema,
  taleMessageId: apiExternalIdSchema.optional(),
  content: z.string().max(20_000),
  format: z.enum(['plain', 'markdown']).default('plain'),
  isCustomer: z.boolean(),
  authorName: z.string().max(300),
  // `.int()` already bounds the value to the safe-integer range; a second
  // `.max()` reported the same problem twice.
  createdAt: z.number().int().min(0),
  attachments: z.array(apiAttachmentSchema).max(10).default([]),
});

export const apiSnapshotSchema = z
  .strictObject({
    source: apiSourceSchema,
    externalId: apiExternalIdSchema,
    externalContactId: apiExternalIdSchema,
    version: z.number().int().min(0),
    subject: z.string().min(1).max(1000),
    status: z.enum(['open', 'closed']),
    deleted: z.boolean().default(false),
    replyConstraints: replyConstraintsSchema.prefault({}),
    messages: z.array(apiSnapshotMessageSchema).max(200),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.messages.map((message) => message.externalId)).size !==
      value.messages.length
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate message identifiers',
      });
    }
    if (value.deleted && value.messages.length !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'A deleted snapshot has no messages',
      });
    }
  });
export type ApiSnapshot = z.infer<typeof apiSnapshotSchema>;
