import { z } from 'zod/v4';

export const modelPresetLiterals = [
  'fast',
  'standard',
  'advanced',
  'vision',
] as const;
export const modelPresetSchema = z.enum(modelPresetLiterals);
export type ModelPreset = z.infer<typeof modelPresetSchema>;

export const versionStatusLiterals = ['draft', 'active', 'archived'] as const;
export const versionStatusSchema = z.enum(versionStatusLiterals);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

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
  includeOrgKnowledge: z.boolean().optional(),
  knowledgeTopK: z.number().optional(),
  toneOfVoiceId: z.string().optional(),
  teamId: z.string().optional(),
  sharedWithTeamIds: z.array(z.string()).optional(),
  createdBy: z.string(),
  isActive: z.boolean(),
  versionNumber: z.number(),
  status: versionStatusSchema,
  rootVersionId: z.string().optional(),
  parentVersionId: z.string().optional(),
  publishedAt: z.number().optional(),
  publishedBy: z.string().optional(),
  changeLog: z.string().optional(),
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
  includeOrgKnowledge: z.boolean().optional(),
  knowledgeTopK: z.number().int().min(1).max(50).optional(),
  toneOfVoiceId: z.string().optional(),
  teamId: z.string().optional(),
  sharedWithTeamIds: z.array(z.string()).optional(),
});
export type CreateCustomAgent = z.infer<typeof createCustomAgentSchema>;

export const updateCustomAgentSchema = createCustomAgentSchema
  .omit({ organizationId: true })
  .partial();
export type UpdateCustomAgent = z.infer<typeof updateCustomAgentSchema>;
