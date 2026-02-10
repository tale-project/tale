import { z } from 'zod/v4';

const modelPresetLiterals = ['fast', 'standard', 'advanced'] as const;
export const modelPresetSchema = z.enum(modelPresetLiterals);
export type ModelPreset = z.infer<typeof modelPresetSchema>;

const versionStatusLiterals = ['draft', 'active', 'archived'] as const;
export const versionStatusSchema = z.enum(versionStatusLiterals);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

const customAgentSchema = z.object({
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
  knowledgeEnabled: z.boolean().optional(),
  includeOrgKnowledge: z.boolean().optional(),
  knowledgeTopK: z.number().optional(),
  toneOfVoiceId: z.string().optional(),
  filePreprocessingEnabled: z.boolean().optional(),
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
type CustomAgent = z.infer<typeof customAgentSchema>;

const createCustomAgentSchema = z.object({
  organizationId: z.string(),
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional(),
  systemInstructions: z.string().min(1).max(50000),
  toolNames: z.array(z.string()),
  modelPreset: modelPresetSchema,
  knowledgeEnabled: z.boolean().optional(),
  includeOrgKnowledge: z.boolean().optional(),
  knowledgeTopK: z.number().int().min(1).max(50).optional(),
  toneOfVoiceId: z.string().optional(),
  filePreprocessingEnabled: z.boolean().optional(),
  teamId: z.string().optional(),
  sharedWithTeamIds: z.array(z.string()).optional(),
});
type CreateCustomAgent = z.infer<typeof createCustomAgentSchema>;

const updateCustomAgentSchema = createCustomAgentSchema
  .omit({ organizationId: true })
  .partial();
type UpdateCustomAgent = z.infer<typeof updateCustomAgentSchema>;
