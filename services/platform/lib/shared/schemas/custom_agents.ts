import { z } from 'zod/v4';

export const modelPresetLiterals = ['fast', 'standard', 'advanced', 'vision'] as const;
export const modelPresetSchema = z.enum(modelPresetLiterals);
export type ModelPreset = z.infer<typeof modelPresetSchema>;

export const customAgentSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	name: z.string(),
	displayName: z.string(),
	description: z.string().optional(),
	avatarUrl: z.string().optional(),
	systemInstructions: z.string(),
	toolNames: z.array(z.string()),
	modelPreset: modelPresetSchema,
	temperature: z.number().optional(),
	maxTokens: z.number().optional(),
	maxSteps: z.number().optional(),
	includeKnowledge: z.boolean(),
	knowledgeTopK: z.number().optional(),
	toneOfVoiceId: z.string().optional(),
	teamId: z.string().optional(),
	sharedWithTeamIds: z.array(z.string()).optional(),
	createdBy: z.string(),
	isActive: z.boolean(),
	currentVersion: z.number(),
});
export type CustomAgent = z.infer<typeof customAgentSchema>;

export const createCustomAgentSchema = z.object({
	organizationId: z.string(),
	name: z.string().min(1).max(100),
	displayName: z.string().min(1).max(200),
	description: z.string().max(1000).optional(),
	avatarUrl: z.string().url().optional(),
	systemInstructions: z.string().min(1).max(50000),
	toolNames: z.array(z.string()),
	modelPreset: modelPresetSchema,
	temperature: z.number().min(0).max(2).optional(),
	maxTokens: z.number().int().min(1).max(128000).optional(),
	maxSteps: z.number().int().min(1).max(100).optional(),
	includeKnowledge: z.boolean(),
	knowledgeTopK: z.number().int().min(1).max(50).optional(),
	toneOfVoiceId: z.string().optional(),
	teamId: z.string().optional(),
	sharedWithTeamIds: z.array(z.string()).optional(),
});
export type CreateCustomAgent = z.infer<typeof createCustomAgentSchema>;

export const updateCustomAgentSchema = createCustomAgentSchema
	.omit({ organizationId: true })
	.partial()
	.extend({
		changeDescription: z.string().max(500).optional(),
	});
export type UpdateCustomAgent = z.infer<typeof updateCustomAgentSchema>;

export const customAgentVersionSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	customAgentId: z.string(),
	version: z.number(),
	systemInstructions: z.string(),
	toolNames: z.array(z.string()),
	modelPreset: modelPresetSchema,
	temperature: z.number().optional(),
	maxTokens: z.number().optional(),
	maxSteps: z.number().optional(),
	includeKnowledge: z.boolean(),
	knowledgeTopK: z.number().optional(),
	createdAt: z.number(),
	createdBy: z.string(),
	changeDescription: z.string().optional(),
});
export type CustomAgentVersion = z.infer<typeof customAgentVersionSchema>;
