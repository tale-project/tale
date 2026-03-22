import { z } from 'zod/v4';

export const FEEDBACK_KEY = '__feedback__';

const humanInputOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
});

const sharedFieldProps = {
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
};

const humanInputFieldSchema = z.discriminatedUnion('type', [
  z.object({
    ...sharedFieldProps,
    type: z.enum(['text', 'textarea', 'number', 'email', 'url', 'tel']),
  }),
  z.object({
    ...sharedFieldProps,
    type: z.enum(['single_select', 'multi_select']),
    options: z.array(humanInputOptionSchema).min(2),
  }),
  z.object({
    ...sharedFieldProps,
    type: z.literal('yes_no'),
    options: z.array(humanInputOptionSchema).length(2).optional(),
  }),
]);

const humanInputResponseSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  respondedBy: z.string(),
  timestamp: z.number(),
});

export const humanInputRequestMetadataSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  fields: z.array(humanInputFieldSchema).min(1),
  requestedAt: z.number(),
  response: humanInputResponseSchema.optional(),
});

export type HumanInputField = z.infer<typeof humanInputFieldSchema>;
export type HumanInputRequestMetadata = z.infer<
  typeof humanInputRequestMetadataSchema
>;
