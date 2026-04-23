import { z } from 'zod/v4';

import { isValidModelRef } from '../utils/model-ref';

const retrievalModeLiterals = ['off', 'tool', 'context', 'both'] as const;
type RetrievalMode = (typeof retrievalModeLiterals)[number];

export function isRetrievalMode(value: string): value is RetrievalMode {
  return (retrievalModeLiterals as readonly string[]).includes(value);
}

const retrievalModeSchema = z.enum(retrievalModeLiterals);

const primaryBehaviorLiterals = ['chat', 'image-generation'] as const;
const primaryBehaviorSchema = z.enum(primaryBehaviorLiterals);

const composerModeSchema = z.object({
  label: z.string().min(1).max(80),
  icon: z.string().max(80).optional(),
  tooltip: z.string().max(300).optional(),
  order: z.number().int().optional(),
});

/**
 * Fields that can be overridden per locale via the i18n key.
 *
 * Canonical location for translatable fields under the i18n-first data model.
 * Top-level translatable fields on `agentJsonSchema` remain only as a legacy
 * fallback for agents authored before this model.
 */
const translatableFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  conversationStarters: z.array(z.string().max(200)).max(4).optional(),
  systemInstructions: z.string().max(20_000).optional(),
});

/**
 * Schema for the agent JSON file format.
 * Matches the AgentJsonConfig type in convex/agents/file_utils.ts.
 *
 * i18n-first: translatable fields live under `i18n.<locale>.*`. The top-level
 * translatable fields (`displayName`, `description`, `conversationStarters`,
 * `systemInstructions`) are legacy fallbacks — the superRefine below requires
 * the relevant ones to exist in *some* locale (top-level or any i18n entry).
 */
export const agentJsonSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    avatarUrl: z.string().url().optional(),
    /**
     * Root behavior this agent runs. Omitted = 'chat' (default tool-calling chat
     * loop). When set to 'image-generation', the user message is routed straight
     * to an image model; toolNames/integrationBindings/workflows are ignored.
     */
    primaryBehavior: primaryBehaviorSchema.optional(),
    systemInstructions: z.string().optional(),
    toolNames: z.array(z.string()).optional(),
    integrationBindings: z.array(z.string()).optional(),
    delegates: z.array(z.string()).optional(),
    workflows: z.array(z.string()).optional(),
    supportedModels: z
      .array(
        z.string().min(1).refine(isValidModelRef, {
          message: 'Invalid model ref (expected "[provider:]model-id")',
        }),
      )
      .min(1),
    provider: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
    knowledgeMode: retrievalModeSchema.optional(),
    webSearchMode: retrievalModeSchema.optional(),
    includeOrgKnowledge: z.boolean().optional(),
    includeTeamKnowledge: z.boolean().optional(),
    knowledgeTopK: z.number().int().min(1).max(50).optional(),
    structuredResponsesEnabled: z.boolean().optional(),
    maxSteps: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().min(1000).optional(),
    outputReserve: z.number().int().optional(),
    /**
     * Max number of integration tool calls allowed for a single agent run.
     * Enforced at the integration-tool wrapper. Agents that cannot call
     * integrations should leave this unset.
     */
    maxIntegrationCallsPerRun: z.number().int().min(1).max(500).optional(),
    composerMode: composerModeSchema.optional(),
    roleRestriction: z.literal('admin_developer').optional(),
    conversationStarters: z.array(z.string().max(200)).max(4).optional(),
    visibleInChat: z.boolean().optional(),
    responseCacheEnabled: z.boolean().optional(),
    responseCacheTtlMs: z.number().int().min(1000).max(604_800_000).optional(),
    noCacheToolNames: z.array(z.string().min(1)).optional(),
    i18n: z
      .record(
        z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        translatableFieldsSchema,
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    const i18nLocales = Object.values(data.i18n ?? {});

    // displayName must exist at top-level or in at least one locale override.
    const hasDisplayName =
      !!data.displayName ||
      i18nLocales.some((v) => v.displayName && v.displayName.length > 0);
    if (!hasDisplayName) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message:
          'displayName must be set at top-level or in at least one i18n locale',
      });
    }

    // Chat agents require systemInstructions in some locale (top-level or i18n).
    if ((data.primaryBehavior ?? 'chat') === 'chat') {
      const hasInstructions =
        (data.systemInstructions != null &&
          data.systemInstructions.length > 0) ||
        i18nLocales.some(
          (v) => v.systemInstructions && v.systemInstructions.length > 0,
        );
      if (!hasInstructions) {
        ctx.addIssue({
          code: 'custom',
          path: ['systemInstructions'],
          message:
            'systemInstructions is required for chat agents at top-level or in at least one i18n locale',
        });
      }
    }

    // Image-generation agents have no tool loop — these fields are meaningless.
    if (data.primaryBehavior === 'image-generation') {
      const disallowed: Array<keyof typeof data> = [
        'toolNames',
        'integrationBindings',
        'workflows',
        'delegates',
      ];
      for (const key of disallowed) {
        const value = data[key];
        if (Array.isArray(value) && value.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${String(key)} is not supported when primaryBehavior is "image-generation" — the agent bypasses the tool loop.`,
          });
        }
      }
    }
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
