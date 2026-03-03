import { z } from 'zod/v4';

const humanInputFormatLiterals = [
  'single_select',
  'multi_select',
  'text_input',
  'yes_no',
] as const;
const humanInputFormatSchema = z.enum(humanInputFormatLiterals);
type HumanInputFormat = z.infer<typeof humanInputFormatSchema>;

const humanInputOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  value: z.string().optional(),
});
type HumanInputOption = z.infer<typeof humanInputOptionSchema>;

const humanInputResponseSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  respondedBy: z.string(),
  timestamp: z.number(),
});
type HumanInputResponse = z.infer<typeof humanInputResponseSchema>;

export const humanInputRequestMetadataSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  format: humanInputFormatSchema,
  options: z.array(humanInputOptionSchema).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  requestedAt: z.number(),
  response: humanInputResponseSchema.optional(),
});
export type HumanInputRequestMetadata = z.infer<
  typeof humanInputRequestMetadataSchema
>;
