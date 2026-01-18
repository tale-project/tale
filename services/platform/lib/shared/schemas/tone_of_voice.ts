import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';

export const toneOfVoiceSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	generatedTone: z.string().optional(),
	lastUpdated: z.number(),
	metadata: jsonRecordSchema.optional(),
});

export type ToneOfVoice = z.infer<typeof toneOfVoiceSchema>;

export const exampleMessageSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	toneOfVoiceId: z.string(),
	content: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	metadata: jsonRecordSchema.optional(),
});

export type ExampleMessage = z.infer<typeof exampleMessageSchema>;

export const toneOfVoiceWithExamplesSchema = z.object({
	toneOfVoice: toneOfVoiceSchema,
	examples: z.array(exampleMessageSchema),
});

export type ToneOfVoiceWithExamples = z.infer<typeof toneOfVoiceWithExamplesSchema>;

export const exampleMessageContentSchema = z.object({
	content: z.string(),
});

export type ExampleMessageContent = z.infer<typeof exampleMessageContentSchema>;

export const generateToneResponseSchema = z.object({
	success: z.boolean(),
	tone: z.string().optional(),
	error: z.string().optional(),
});

export type GenerateToneResponse = z.infer<typeof generateToneResponseSchema>;
