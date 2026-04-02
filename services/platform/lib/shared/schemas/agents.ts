import { z } from 'zod/v4';

const modelPresetLiterals = ['fast', 'standard', 'advanced'] as const;
export const modelPresetSchema = z.enum(modelPresetLiterals);
export type ModelPreset = z.infer<typeof modelPresetSchema>;

const retrievalModeLiterals = ['off', 'tool', 'context', 'both'] as const;
type RetrievalMode = (typeof retrievalModeLiterals)[number];

export function isRetrievalMode(value: string): value is RetrievalMode {
  return (retrievalModeLiterals as readonly string[]).includes(value);
}

const retrievalModeSchema = z.enum(retrievalModeLiterals);

/**
 * Fields that can be overridden per locale via the i18n key.
 */
const translatableFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  conversationStarters: z.array(z.string().max(200)).max(4).optional(),
});

/**
 * Schema for the agent JSON file format.
 * Matches the AgentJsonConfig type in convex/agents/file_utils.ts.
 */
export const agentJsonSchema = z.object({
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  avatarUrl: z.string().url().optional(),
  systemInstructions: z.string().min(1),
  toolNames: z.array(z.string()).optional(),
  integrationBindings: z.array(z.string()).optional(),
  delegates: z.array(z.string()).optional(),
  workflows: z.array(z.string()).optional(),
  modelPreset: modelPresetSchema.optional(),
  modelId: z.string().optional(),
  knowledgeMode: retrievalModeSchema.optional(),
  webSearchMode: retrievalModeSchema.optional(),
  includeOrgKnowledge: z.boolean().optional(),
  includeTeamKnowledge: z.boolean().optional(),
  knowledgeTopK: z.number().int().min(1).max(50).optional(),
  structuredResponsesEnabled: z.boolean().optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
  outputReserve: z.number().int().optional(),
  roleRestriction: z.literal('admin_developer').optional(),
  conversationStarters: z.array(z.string().max(200)).max(4).optional(),
  visibleInChat: z.boolean().optional(),
  i18n: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      translatableFieldsSchema,
    )
    .optional(),
});
type AgentJson = z.infer<typeof agentJsonSchema>;

/**
 * Schema for creating a new agent (filename validation).
 */
const createAgentSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  config: agentJsonSchema,
});
type CreateAgent = z.infer<typeof createAgentSchema>;
