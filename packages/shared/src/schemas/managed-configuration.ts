import { z } from 'zod';

import { AGENT_TOOL_CATALOG, normalizeToolGrants } from '../agent-tool-grants';
import { isValidAutomationName } from '../automation-name';
import { TASK_DESCRIPTION_MAX } from '../task-limits';
import { isoDateSchema, staticInputSchema } from './automation-trigger';
import { configurationHashSchema } from './configuration';
import {
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_BINDINGS_MAX,
  projectAgentInputSchema,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
} from './projects';
import { normalizeScheduleRule, scheduleRuleSchema } from './schedule-rule';

/** Explicit identities: these resources never find a target by display name.
 * Review contexts alone may explicitly create their declared UUID. Native writers retain the
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
/** Model adoption selects one explicit provider; native observations may retain
 * an older unpinned provider without silently choosing one during the read. */
export const managedAgentModelSchema = projectAgentInputSchema
  .pick({ harness: true, model: true, modelProvider: true })
  .extend({
    ...project,
    agentId: identity,
    model: projectAgentInputSchema.shape.model.trim().min(1),
    modelProvider: projectAgentInputSchema.shape.modelProvider
      .unwrap()
      .trim()
      .min(1),
  })
  .strict();
export const managedAgentModelObservationSchema =
  managedAgentModelSchema.extend({
    model: projectAgentInputSchema.shape.model,
    modelProvider: projectAgentInputSchema.shape.modelProvider
      .unwrap()
      .nullable(),
  });
export const managedTaskInstructionsSchema = z.strictObject({
  ...project,
  taskId: identity,
  description: z.string().max(TASK_DESCRIPTION_MAX),
});

/** Explicit enrollment of a pristine operational task. The reviewer identity
 * is permanent; disabling the context does not turn it into source work. */
export const managedTaskReviewContextSchema = z.strictObject({
  ...project,
  taskId: identity,
  reviewerAgentId: identity,
  enabled: z.boolean(),
});
export type ManagedTaskReviewContext = z.infer<
  typeof managedTaskReviewContextSchema
>;

/** Creation is an explicit apply policy, not part of the stored config/hash.
 * Existing adoption-only identities remain compatible. */
export const managedTaskReviewContextProvisionSchema = z
  .strictObject({
    config: managedTaskReviewContextSchema,
    createIfMissing: z.literal(true).optional(),
  })
  .refine(
    (value) =>
      value.createIfMissing !== true ||
      z.uuid().safeParse(value.config.taskId).success,
    {
      path: ['config', 'taskId'],
      message: 'Creation requires a stable UUID task ID',
    },
  );

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
 * when it is `skip` (the default `latest` is left out), a fixed input only
 * when it has one, and the slot-wake opt-in only when it is on, so a
 * schedule that sets none of them hashes as before. */
const scheduleExtras = {
  catchUp: z.literal('skip').optional(),
  input: staticInputSchema.optional(),
  // Fire this schedule early when an agent of its project frees its slot
  // (#4540). Only `true` is declared: an absent key is the opt-out, so a
  // readback and an equivalent declaration always hash alike.
  wakeOnSlotFreed: z.literal(true).optional(),
};

/** A managed schedule's zone, stored the way the declaration spells it (any
 * spelling `Intl` resolves): spaces around it are refused, since a stored
 * zone with them never compared equal to its declaration. */
const managedZone = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (zone) => zone.trim() === zone,
    'A time zone cannot start or end with a space.',
  );

/** A managed schedule runs on a cron expression or a repeat rule. The cron
 * shape keeps exactly the keys it always had, so an existing schedule's hash
 * does not move and nothing reads as drifted. A repeat rule reads in its
 * normal form (times and weekdays sorted and once each, a window that spans
 * the whole week dropped) — the form the platform stores — so a declaration
 * and its readback hash alike whatever order the file lists them in. */
export const managedAutomationScheduleSchema = z.union([
  z.strictObject({
    ...project,
    name,
    cron: z.string().min(1).max(200),
    timezone: managedZone,
    enabled: z.boolean(),
    ...scheduleExtras,
  }),
  z.strictObject({
    ...project,
    name,
    repeat: scheduleRuleSchema.transform(normalizeScheduleRule),
    startDate: isoDateSchema,
    timezone: managedZone,
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
    kind: z.literal('agent-model'),
    config: managedAgentModelSchema,
  }),
  z.strictObject({
    kind: z.literal('task-instructions'),
    config: managedTaskInstructionsSchema,
  }),
  managedTaskReviewContextProvisionSchema.safeExtend({
    kind: z.literal('task-review-context'),
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
