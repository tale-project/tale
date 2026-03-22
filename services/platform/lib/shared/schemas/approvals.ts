import { z } from 'zod/v4';

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
    options: z.array(humanInputOptionSchema),
  }),
  z.object({
    ...sharedFieldProps,
    type: z.literal('yes_no'),
    options: z.array(humanInputOptionSchema).optional(),
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
  fields: z.array(humanInputFieldSchema),
  requestedAt: z.number(),
  response: humanInputResponseSchema.optional(),
});

export type HumanInputOption = z.infer<typeof humanInputOptionSchema>;
export type HumanInputField = z.infer<typeof humanInputFieldSchema>;
export type HumanInputRequestMetadata = z.infer<
  typeof humanInputRequestMetadataSchema
>;
