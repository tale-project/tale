import { z } from 'zod';

import { AGENT_TOOL_CATALOG, normalizeToolGrants } from '../agent-tool-grants';
import { isValidAutomationName } from '../automation-name';
import { TASK_DESCRIPTION_MAX } from '../task-limits';
import { configurationHashSchema } from './configuration';
import {
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
} from './projects';

/** Explicit adoption: these resources never find a target by display name or
 * create a second project, agent or standing task. Native writers retain the
 * authority, occupancy, audit and validation rules of those resources. */
const identity = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/\\\x00-\x20\x7f]+$/);
const project = { projectId: identity };
const name = z
  .string()
  .min(1)
  .max(200)
  .refine(isValidAutomationName, 'Invalid native automation name');

export const managedProjectInstructionsSchema = z.strictObject({
  ...project,
  instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX_CHARS),
});
export const managedAgentInstructionsSchema = z.strictObject({
  ...project,
  agentId: identity,
  instructions: z.string().trim().max(PROJECT_AGENT_INSTRUCTIONS_MAX),
});
export const managedAgentToolsSchema = z.strictObject({
  ...project,
  agentId: identity,
  tools: z
    .array(z.enum(AGENT_TOOL_CATALOG.map((tool) => tool.name)))
    .max(PROJECT_AGENT_BINDINGS_MAX)
    .transform((tools) => normalizeToolGrants(tools)),
});
export const managedTaskInstructionsSchema = z.strictObject({
  ...project,
  taskId: identity,
  description: z.string().max(TASK_DESCRIPTION_MAX),
});

/** The native authoring dispatcher validates documents and runs their tests.
 * Metadata is explicit: null clears it; an omitted field must never silently
 * erase a value that an existing automation owns. */
export const managedAutomationDefinitionSchema = z.strictObject({
  ...project,
  name,
  document: z.record(z.string(), z.unknown()),
  settings: z.json().nullable(),
  presentation: z.json().nullable(),
  taskContract: z.json().nullable(),
});
export const managedAutomationDeploymentSchema = z.strictObject({
  ...project,
  name,
  definitionSha256: configurationHashSchema,
});
export const managedAutomationScheduleSchema = z.strictObject({
  ...project,
  name,
  cron: z.string().min(1).max(200),
  timezone: z.string().min(1).max(100),
  enabled: z.boolean(),
});

export const managedPlatformResourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('project-instructions'),
    config: managedProjectInstructionsSchema,
  }),
  z.strictObject({
    kind: z.literal('agent-instructions'),
    config: managedAgentInstructionsSchema,
  }),
  z.strictObject({
    kind: z.literal('agent-tools'),
    config: managedAgentToolsSchema,
  }),
  z.strictObject({
    kind: z.literal('task-instructions'),
    config: managedTaskInstructionsSchema,
  }),
  z.strictObject({
    kind: z.literal('automation-definition'),
    config: managedAutomationDefinitionSchema,
  }),
  z.strictObject({
    kind: z.literal('automation-deployment'),
    config: managedAutomationDeploymentSchema,
  }),
  z.strictObject({
    kind: z.literal('automation-schedule'),
    config: managedAutomationScheduleSchema,
  }),
]);
export type ManagedPlatformResource = z.infer<
  typeof managedPlatformResourceSchema
>;
export type ManagedAutomationDefinition = z.infer<
  typeof managedAutomationDefinitionSchema
>;
