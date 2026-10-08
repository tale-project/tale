import { z } from 'zod';

import { AGENT_TOOL_CATALOG, normalizeToolGrants } from '../agent-tool-grants';
import { isValidAutomationName } from '../automation-name';
import { TASK_DESCRIPTION_MAX } from '../task-limits';
import { isoDateSchema, staticInputSchema } from './automation-trigger';
import { configurationHashSchema } from './configuration';
import {
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
} from './projects';
import { scheduleRuleSchema } from './schedule-rule';

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
/** What a managed schedule may add beside its definition: `catchUp` only
 * when it is `skip` (the default `latest` is left out) and a fixed input only
 * when it has one, so a schedule that sets neither hashes as before. */
const scheduleExtras = {
  catchUp: z.literal('skip').optional(),
  input: staticInputSchema.optional(),
};

/** A managed schedule runs on a cron expression or a repeat rule. The cron
 * shape keeps exactly the keys it always had, so an existing schedule's hash
 * does not move and nothing reads as drifted. */
export const managedAutomationScheduleSchema = z.union([
  z.strictObject({
    ...project,
    name,
    cron: z.string().min(1).max(200),
    timezone: z.string().min(1).max(100),
    enabled: z.boolean(),
    ...scheduleExtras,
  }),
  z.strictObject({
    ...project,
    name,
    repeat: scheduleRuleSchema,
    startDate: isoDateSchema,
    timezone: z.string().min(1).max(100),
    enabled: z.boolean(),
    ...scheduleExtras,
  }),
]);

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
