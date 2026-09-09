import { z } from 'zod';

export const apiSourceSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/);
export const apiDeliveryFailureSchema = z.object({
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
export const apiAttachmentSchema = z.object({
  externalId: z.string().min(1).max(256).optional(),
  storageId: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(300),
  contentType: z.string().min(1).max(255),
  size: z
    .number()
    .int()
    .min(0)
    .max(30 * 1024 * 1024),
});
export const replyConstraintsSchema = z.object({
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
export const apiSnapshotSchema = z
  .object({
    source: apiSourceSchema,
    externalId: z.string().min(1).max(256),
    externalContactId: z.string().min(1).max(256),
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    subject: z.string().min(1).max(1000),
    status: z.enum(['open', 'closed']),
    deleted: z.boolean().default(false),
    replyConstraints: replyConstraintsSchema.prefault({}),
    messages: z
      .array(
        z.object({
          externalId: z.string().min(1).max(256),
          taleMessageId: z.string().min(1).max(256).optional(),
          content: z.string().max(20_000),
          format: z.enum(['plain', 'markdown']).default('plain'),
          isCustomer: z.boolean(),
          authorName: z.string().max(300),
          createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          attachments: z.array(apiAttachmentSchema).max(10).default([]),
        }),
      )
      .max(200),
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
