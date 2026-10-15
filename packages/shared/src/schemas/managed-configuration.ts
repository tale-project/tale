import { z } from 'zod';

import { AGENT_TOOL_CATALOG, normalizeToolGrants } from '../agent-tool-grants';
import { isValidAutomationName } from '../automation-name';
import {
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_LABELS_MAX,
  TASK_PRIORITIES,
  TASK_TITLE_MAX,
} from '../task-limits';
import { isoDateSchema, staticInputSchema } from './automation-trigger';
import { configurationHashSchema } from './configuration';
import {
  DISPATCH_POOL_MAX,
  DISPATCH_STANDING_ROLES_MAX,
  projectDispatchSchema,
  storedProjectDispatchSchema,
} from './project-dispatch';
import {
  PROJECT_AGENT_INSTRUCTIONS_MAX,
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_NAME_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  PROJECT_SHARED_TEAMS_MAX,
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

/** A project's dispatch (`./project-dispatch`): its pool, how many runs it
 * holds, which columns and labels count as ready, how starts are admitted,
 * its standing roles and the gates it declares. Managed configuration may
 * create it; the platform checks that every agent, task and label it names
 * is the project's. What is reported on a gate is runtime state, kept apart
 * from the document, so it is never declared and never drifts a plan. */
export const managedProjectDispatchSchema = projectDispatchSchema.safeExtend({
  ...project,
});
export type ManagedProjectDispatch = z.infer<
  typeof managedProjectDispatchSchema
>;
/** A project's dispatch as the platform reads it back: the stored shape,
 * which still reads a dispatch saved before a write's later rules, so a
 * plan can adopt and correct it rather than fail to read it. */
export const managedProjectDispatchObservationSchema =
  storedProjectDispatchSchema.safeExtend({ ...project });

/** Text a declaration states the way the platform stores it — composed
 * (NFC) and without surrounding spaces — or it would never read back as
 * declared and every plan would show it changed. */
function storedText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value === value.normalize('NFC').trim(),
      'Write it trimmed and NFC-composed, the way Tale stores it',
    );
}

/** A set of names, read in one order whatever order a file lists them in,
 * so a declaration and its readback hash alike. */
function nameSet(item: z.ZodType<string>, max: number) {
  return z
    .array(item)
    .max(max)
    .refine(
      (values) => new Set(values).size === values.length,
      'List each entry once',
    )
    .transform((values) =>
      [...values].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
}

/** Creation names a stable UUID the declaration chooses: a retried apply then
 * finds what an interrupted one created instead of creating it twice. */
function createsUnderUuid(field: string) {
  return (value: { config: object; createIfMissing?: true }) =>
    value.createIfMissing !== true ||
    z.uuid().safeParse(Reflect.get(value.config, field)).success;
}

/** A project: its name, and — when stated — its description and the teams
 * it is shared with (empty is organization-wide). A field left out keeps
 * what is stored; `null` clears the description. */
export const managedProjectSchema = z.strictObject({
  ...project,
  name: storedText(PROJECT_NAME_MAX),
  description: storedText(PROJECT_DESCRIPTION_MAX).nullable().optional(),
  teamIds: z
    .array(identity)
    .max(PROJECT_SHARED_TEAMS_MAX + 1)
    .refine(
      (teamIds) => new Set(teamIds).size === teamIds.length,
      'List each team once',
    )
    .optional(),
});
export type ManagedProject = z.infer<typeof managedProjectSchema>;

/** A project's label, named as its catalog spells it. Tale derives a
 * label's colour from its name, so a label has nothing else to declare. */
export const managedProjectLabelSchema = z.strictObject({
  ...project,
  name: storedText(TASK_LABEL_CHARS_MAX),
});
export type ManagedProjectLabel = z.infer<typeof managedProjectLabelSchema>;

/** A secret's name, which a running agent reads as an environment
 * variable of that name. */
export const agentSecretNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use an environment variable name');

/** A project agent's name and equipment: the connectors, secrets and skills
 * it may use. Its harness and model belong to `agent-model`, its
 * instructions to `agent-instructions` and its tools to `agent-tools`, so
 * no two kinds own one field. A list left out keeps what is stored. */
export const managedProjectAgentSchema = z.strictObject({
  ...project,
  agentId: identity,
  name: storedText(PROJECT_AGENT_NAME_MAX),
  connectors: nameSet(identity, PROJECT_AGENT_BINDINGS_MAX).optional(),
  secrets: nameSet(
    agentSecretNameSchema,
    PROJECT_AGENT_BINDINGS_MAX,
  ).optional(),
  skills: nameSet(identity, PROJECT_AGENT_BINDINGS_MAX).optional(),
});
export type ManagedProjectAgent = z.infer<typeof managedProjectAgentSchema>;

/** The columns a declared task may start in; afterwards its status is the
 * work's own and never read against the declaration. */
export const MANAGED_TASK_INITIAL_STATUSES = ['backlog', 'todo'] as const;

/** A standing task: its title and — when stated — its labels, the project
 * agent it is assigned to (`null` for nobody) and its priority (`null` for
 * none). A field left out keeps what is stored. Its description belongs to
 * `task-instructions`; its status is never declared. */
export const managedTaskSchema = z.strictObject({
  ...project,
  taskId: identity,
  title: storedText(TASK_TITLE_MAX),
  labels: nameSet(storedText(TASK_LABEL_CHARS_MAX), TASK_LABELS_MAX)
    .refine(
      (labels) =>
        new Set(labels.map((label) => label.toLowerCase())).size ===
        labels.length,
      'A label is one label whatever its case',
    )
    .optional(),
  assigneeAgentId: identity.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
});
export type ManagedTask = z.infer<typeof managedTaskSchema>;

/** Where a declared secret's value is read when the declaration is applied:
 * an environment variable of the CLI that applies it (inside a deployment,
 * the platform's own environment). The prefix keeps the platform's own
 * variables — its database address, its signing keys — out of reach, as
 * `providerKeyEnvNameSchema` does for provider keys. */
export const MANAGED_SECRET_ENV_PREFIX = 'TALE_CONFIG_SECRET_';
export const managedSecretEnvNameSchema = z
  .string()
  .max(80)
  .regex(
    /^TALE_CONFIG_SECRET_[A-Za-z0-9_]+$/,
    `must start with ${MANAGED_SECRET_ENV_PREFIX} and contain only letters, digits and underscores`,
  );

/** An organization's agent secret whose value comes from the environment
 * when the declaration is applied. The declaration and its plan carry the
 * variable's name, never the value. */
export const managedAgentSecretSchema = z.strictObject({
  name: agentSecretNameSchema,
  envName: managedSecretEnvNameSchema,
});
export type ManagedAgentSecret = z.infer<typeof managedAgentSecretSchema>;

/** The secret fields each way a connector credential signs in takes. A
 * sign-in the outside system renews (`oauth2`) needs a person's consent in
 * Tale and is never declared. */
export const MANAGED_CONNECTOR_FIELDS = {
  'api-key': { required: ['token'], optional: [] },
  bearer: { required: ['token'], optional: [] },
  basic: {
    required: ['username', 'password'],
    optional: ['smtpUsername', 'smtpPassword'],
  },
} as const;
export type ManagedConnectorAuthMethod = keyof typeof MANAGED_CONNECTOR_FIELDS;
const connectorField = z.enum([
  'token',
  'username',
  'password',
  'smtpUsername',
  'smtpPassword',
]);

const managedConnectorCredentialShape = {
  connector: identity,
  name: storedText(100),
  authMethod: z.enum(['api-key', 'bearer', 'basic']),
  endpoint: z
    .url({ protocol: /^https$/ })
    .refine(
      (value) => new URL(value).origin === value,
      'An endpoint is an origin only, such as https://example.atlassian.net',
    )
    .optional(),
  isDefault: z.boolean().optional(),
};

/** What the platform is told of a declared connector credential besides its
 * values: everything but where the values come from. */
export const managedConnectorCredentialTargetSchema = z.strictObject(
  managedConnectorCredentialShape,
);

/** A connector credential whose secret fields come from the environment
 * when the declaration is applied. `endpoint` is the API origin of a
 * connector that takes one per credential; `isDefault`, when stated, makes
 * it (or stops it being) its connector's default. */
export const managedConnectorCredentialSchema = z
  .strictObject({
    ...managedConnectorCredentialShape,
    fields: z.partialRecord(
      connectorField,
      z.strictObject({ env: managedSecretEnvNameSchema }),
    ),
  })
  .superRefine((credential, context) => {
    const { required, optional } = MANAGED_CONNECTOR_FIELDS[
      credential.authMethod
    ] as { required: readonly string[]; optional: readonly string[] };
    const named = Object.keys(credential.fields);
    for (const field of required)
      if (!named.includes(field))
        context.addIssue({
          code: 'custom',
          path: ['fields', field],
          message: `A ${credential.authMethod} credential needs ${field}`,
        });
    for (const field of named)
      if (!required.includes(field) && !optional.includes(field))
        context.addIssue({
          code: 'custom',
          path: ['fields', field],
          message: `A ${credential.authMethod} credential takes no ${field}`,
        });
    if (
      credential.authMethod === 'basic' &&
      named.includes('smtpUsername') !== named.includes('smtpPassword')
    )
      context.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Declare the SMTP user name and password together',
      });
  });
export type ManagedConnectorCredential = z.infer<
  typeof managedConnectorCredentialSchema
>;

/** What the platform reads back of a managed secret: never the value, only
 * a slow, salted digest of it (`managedSecretDigest` in
 * `@tale/shared/config/managed-secret`), which the CLI
 * compares with the digest of the value it would write. */
export const managedSecretDigestSchema = z
  .string()
  .regex(/^pbkdf2-sha256:[a-f0-9]{64}$/);

/** What the platform answers for each kind a declaration may create, in
 * the shape its writer reads it: every field a declaration may leave out
 * present, the values as stored. Readback is parsed with these, not with
 * the declaration's own rules, so a value stored before a rule tightened
 * still reads (and differs) rather than failing the read. */
export const managedObservationSchemas = {
  project: z.strictObject({
    projectId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    teamIds: z.array(z.string()),
  }),
  'project-label': z.strictObject({
    projectId: z.string(),
    name: z.string(),
  }),
  'project-agent': z.strictObject({
    projectId: z.string(),
    agentId: z.string(),
    name: z.string(),
    connectors: z.array(z.string()),
    secrets: z.array(z.string()),
    skills: z.array(z.string()),
  }),
  task: z.strictObject({
    projectId: z.string(),
    taskId: z.string(),
    title: z.string(),
    labels: z.array(z.string()),
    assigneeAgentId: z.string().nullable(),
    priority: z.enum(TASK_PRIORITIES).nullable(),
  }),
  'agent-secret': z.strictObject({
    name: z.string(),
    valueDigest: managedSecretDigestSchema.nullable(),
  }),
  'connector-credential': z.strictObject({
    connector: z.string(),
    name: z.string(),
    authMethod: z.string(),
    endpoint: z.string().nullable(),
    isDefault: z.boolean(),
    fields: z.array(z.string()),
    valueDigest: managedSecretDigestSchema.nullable(),
  }),
} as const;
export type ManagedObservation<
  K extends keyof typeof managedObservationSchemas,
> = z.infer<(typeof managedObservationSchemas)[K]>;

/** What a declaration creates in one project, which a check of its
 * dispatch counts as the project's before anything is written: the agents,
 * the tasks and the labels it declares there that the dispatch names, and —
 * `project` — that it creates the project itself. A save never reads it. */
export const managedDispatchPlanSchema = z.strictObject({
  project: z.literal(true).optional(),
  // The pool's agents and the standing roles', which may stand outside it.
  agents: z
    .array(identity)
    .max(DISPATCH_POOL_MAX + DISPATCH_STANDING_ROLES_MAX),
  tasks: z.array(identity).max(512),
  labels: z.array(storedText(TASK_LABEL_CHARS_MAX)).max(512),
});
export type ManagedDispatchPlan = z.infer<typeof managedDispatchPlanSchema>;

export const managedPlatformResourceSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('project'),
      config: managedProjectSchema,
      createIfMissing: z.literal(true).optional(),
      /** The task key the project is created with; fixed afterwards. */
      key: z
        .string()
        .regex(/^[A-Z][A-Z0-9]{1,5}$/, 'A key is 2 to 6 capitals and digits')
        .optional(),
    })
    .refine(createsUnderUuid('projectId'), {
      path: ['config', 'projectId'],
      message: 'Creation requires a stable UUID project ID',
    })
    .refine(
      (value) => value.key === undefined || value.createIfMissing === true,
      { path: ['key'], message: 'A key is chosen only when creating' },
    ),
  z.strictObject({
    kind: z.literal('project-label'),
    config: managedProjectLabelSchema,
    createIfMissing: z.literal(true).optional(),
  }),
  z
    .strictObject({
      kind: z.literal('project-agent'),
      config: managedProjectAgentSchema,
      createIfMissing: z.literal(true).optional(),
    })
    .refine(createsUnderUuid('agentId'), {
      path: ['config', 'agentId'],
      message: 'Creation requires a stable UUID agent ID',
    }),
  z
    .strictObject({
      kind: z.literal('task'),
      config: managedTaskSchema,
      createIfMissing: z.literal(true).optional(),
      /** The column a created task starts in (backlog unless stated). */
      initialStatus: z.enum(MANAGED_TASK_INITIAL_STATUSES).optional(),
    })
    .refine(createsUnderUuid('taskId'), {
      path: ['config', 'taskId'],
      message: 'Creation requires a stable UUID task ID',
    })
    .refine(
      (value) =>
        value.initialStatus === undefined || value.createIfMissing === true,
      {
        path: ['initialStatus'],
        message: 'An initial status is chosen only when creating',
      },
    ),
  z.strictObject({
    kind: z.literal('agent-secret'),
    config: managedAgentSecretSchema,
    createIfMissing: z.literal(true).optional(),
  }),
  z.strictObject({
    kind: z.literal('connector-credential'),
    config: managedConnectorCredentialSchema,
    createIfMissing: z.literal(true).optional(),
  }),
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
  z.strictObject({
    kind: z.literal('project-dispatch'),
    config: managedProjectDispatchSchema,
  }),
]);
export type ManagedPlatformResource = z.infer<
  typeof managedPlatformResourceSchema
>;
export type ManagedAutomationDefinition = z.infer<
  typeof managedAutomationDefinitionSchema
>;
