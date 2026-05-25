import { z } from 'zod/v4';

import { isValidModelRef } from '../utils/model-ref';

/**
 * Allowlist for project icons (lucide-react icon names).
 *
 * Server-enforced via Zod; the UI also constrains the picker to this set.
 * Keep in sync with `project-color-icon-picker.tsx` icon catalog.
 */
export const PROJECT_ICONS = [
  'FolderKanban',
  'Folder',
  'FolderOpen',
  'FolderTree',
  'FolderGit2',
  'Briefcase',
  'Building2',
  'Layers',
  'Box',
  'BookOpen',
  'GraduationCap',
  'Lightbulb',
  'Rocket',
  'Target',
  'Flag',
  'Compass',
  'Map',
  'Star',
  'Beaker',
  'FlaskConical',
  'Microscope',
  'Atom',
  'Cpu',
  'Code',
  'Heart',
  'Users',
  'MessageSquare',
  'Phone',
  'Mail',
  'Globe',
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export const projectIconSchema = z.enum(PROJECT_ICONS);

/**
 * Allowlist for project colors (token names from the existing palette).
 *
 * Each token resolves to a 50/500/900 triple in the @tale/ui design tokens
 * via the theme resolver. No hex strings on the wire.
 */
export const PROJECT_COLORS = [
  'gray',
  'slate',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];
export const projectColorSchema = z.enum(PROJECT_COLORS);

/** Tristate mode for agents/models restriction. */
export const projectModeSchema = z.enum(['all', 'recommended', 'restricted']);
export type ProjectMode = z.infer<typeof projectModeSchema>;

/** Knowledge mode mirrors the agent knowledge mode set. */
export const projectKnowledgeModeSchema = z.enum([
  'off',
  'tool',
  'context',
  'both',
]);
export type ProjectKnowledgeMode = z.infer<typeof projectKnowledgeModeSchema>;

export const projectIntegrationsModeSchema = z.enum(['all', 'restricted']);
export type ProjectIntegrationsMode = z.infer<
  typeof projectIntegrationsModeSchema
>;

/**
 * Hard caps mirrored on the Convex mutation boundary. Token budget for
 * instructions is ~1200; using 6000 chars as a generous overhead since
 * a token is typically 4 chars in English. Truncation to the token
 * budget happens at chat-time in `buildProjectInstructions`.
 */
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 500;
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 6000;
export const PROJECT_INSTRUCTIONS_TOKEN_BUDGET = 1200;
export const PROJECT_SHARED_TEAMS_MAX = 20;
export const PROJECT_RECOMMENDED_AGENTS_MAX = 20;
export const PROJECT_ALLOWED_AGENTS_MAX = 50;
export const PROJECT_RECOMMENDED_MODELS_MAX = 10;
export const PROJECT_ALLOWED_MODELS_MAX = 50;
export const PROJECT_ALLOWED_INTEGRATIONS_MAX = 50;

const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX);

const projectDescriptionSchema = z.string().trim().max(PROJECT_DESCRIPTION_MAX);

const projectInstructionsSchema = z
  .string()
  .max(PROJECT_INSTRUCTIONS_MAX_CHARS);

const teamIdSchema = z.string().min(1);
const sharedWithTeamIdsSchema = z
  .array(teamIdSchema)
  .max(PROJECT_SHARED_TEAMS_MAX);

const agentSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const modelRefSchema = z.string().min(1).refine(isValidModelRef, {
  message: 'Invalid model ref (expected "[provider:]model-id")',
});

const integrationSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const createProjectInputSchema = z.object({
  organizationId: z.string().min(1),
  name: projectNameSchema,
  description: projectDescriptionSchema.optional(),
  icon: projectIconSchema.optional(),
  color: projectColorSchema.optional(),
  teamId: teamIdSchema.optional(),
  sharedWithTeamIds: sharedWithTeamIdsSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectIdentitySchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema,
    icon: projectIconSchema.nullable(),
    color: projectColorSchema.nullable(),
  })
  .partial();
export type UpdateProjectIdentityInput = z.infer<
  typeof updateProjectIdentitySchema
>;

export const updateProjectInstructionsSchema = z.object({
  instructions: projectInstructionsSchema,
});
export type UpdateProjectInstructionsInput = z.infer<
  typeof updateProjectInstructionsSchema
>;

export const updateProjectSharingSchema = z.object({
  teamId: teamIdSchema.nullable().optional(),
  sharedWithTeamIds: sharedWithTeamIdsSchema.optional(),
});
export type UpdateProjectSharingInput = z.infer<
  typeof updateProjectSharingSchema
>;

export const updateProjectKnowledgeModeSchema = z.object({
  knowledgeMode: projectKnowledgeModeSchema,
});
export type UpdateProjectKnowledgeModeInput = z.infer<
  typeof updateProjectKnowledgeModeSchema
>;

export const updateProjectAgentSettingsSchema = z.object({
  agentMode: projectModeSchema,
  recommendedAgentSlugs: z
    .array(agentSlugSchema)
    .max(PROJECT_RECOMMENDED_AGENTS_MAX)
    .optional(),
  allowedAgentSlugs: z
    .array(agentSlugSchema)
    .max(PROJECT_ALLOWED_AGENTS_MAX)
    .optional(),
});
export type UpdateProjectAgentSettingsInput = z.infer<
  typeof updateProjectAgentSettingsSchema
>;

export const updateProjectModelSettingsSchema = z.object({
  modelMode: projectModeSchema,
  recommendedModels: z
    .array(modelRefSchema)
    .max(PROJECT_RECOMMENDED_MODELS_MAX)
    .optional(),
  allowedModels: z
    .array(modelRefSchema)
    .max(PROJECT_ALLOWED_MODELS_MAX)
    .optional(),
});
export type UpdateProjectModelSettingsInput = z.infer<
  typeof updateProjectModelSettingsSchema
>;

export const updateProjectIntegrationsSchema = z.object({
  integrationsMode: projectIntegrationsModeSchema,
  allowedIntegrationSlugs: z
    .array(integrationSlugSchema)
    .max(PROJECT_ALLOWED_INTEGRATIONS_MAX)
    .optional(),
});
export type UpdateProjectIntegrationsInput = z.infer<
  typeof updateProjectIntegrationsSchema
>;

export const deleteProjectInputSchema = z.object({
  mode: z.enum(['detach', 'cascade']),
  confirmPhrase: z.string().optional(),
});
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;
