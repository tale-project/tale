/**
 * The settings a coding agent reads and changes through Tale's MCP settings
 * tools, described once for every reader: the platform's settings registry
 * routes a change by its kind and applies changes in each kind's `order`,
 * the endpoint's reference teaches each kind from its `description`, and the
 * coverage guard joins every page of Settings to the kinds that cover it
 * through `areas`. The CLI declares the kinds marked `cli`; the guard in
 * `settings-kinds.test.ts` holds them to the native resource model the CLI
 * parses, so the CLI never accepts a kind the platform does not describe.
 *
 * Pure data: the browser reads it as well as the server.
 */

/**
 * Every page of Settings, by its path under
 * `/dashboard/<organization>/settings/`; a section with tabs is named by each
 * of its tabs. The platform's coverage guard holds this list equal to the
 * settings rail, so a page cannot be added without its story here.
 */
export const SETTINGS_AREAS = [
  'account',
  'personalization',
  'notifications',
  'usage',
  'organization',
  'teams',
  'members',
  'providers',
  'connectors',
  'skills',
  'branding',
  'sandboxes',
  'governance/content-models',
  'governance/policies-limits',
  'governance/security-monitoring',
  'governance/competences',
  'governance/guardrails',
  'governance/logs',
  'governance/legal-hold',
  'governance/data-subject-requests',
  'governance/trash',
  'metrics/usage',
  'metrics/feedback',
  'metrics/chat-health',
  'metrics/external-turns',
  'metrics/automations',
  'metrics/projects',
  'api/rest',
  'api/models',
  'api/mcp',
  'api/agents',
  'api/webdav',
  'enterprise-sso',
  'data-residency',
] as const;
export type SettingsArea = (typeof SETTINGS_AREAS)[number];

/** Whose setting it is: the organization's, one person's, the deployment's
 * (every organization on it), or one project's. */
export type SettingsScope = 'organization' | 'user' | 'instance' | 'project';

/** What a change does to one resource: `set` replaces it whole (creating it
 * when absent), `delete` removes it. One-shot actions are the kind's `acts`. */
export type SettingsOp = 'set' | 'delete';

export type SettingsRisk = 'low' | 'high' | 'critical';

/**
 * What a planned change does beyond replacing a value, each with the risk it
 * carries. A change's risk is the highest of its kind's `baseRisk` and its
 * effects'. The codes are a stable vocabulary: the agent reads them in a
 * plan, and Tale shows them, translated, to the person who finishes a
 * change.
 */
export const SETTINGS_EFFECTS = {
  'signs-out-members': 'critical',
  'may-lock-out-members': 'critical',
  'removes-human-approval': 'critical',
  'changes-serving-account': 'high',
  'breaks-dependents': 'high',
  'requires-empty-corpus': 'critical',
  're-embeds-documents': 'critical',
  'restart-required': 'critical',
  'sends-email': 'high',
  'revokes-access': 'high',
  irreversible: 'critical',
  'erases-personal-data': 'critical',
  'staged-cooldown': 'critical',
  'reaches-vendor': 'high',
  'ends-running-work': 'high',
} as const satisfies Record<string, Exclude<SettingsRisk, 'low'>>;
export type SettingsEffect = keyof typeof SETTINGS_EFFECTS;

export interface SettingsKindDescriptor {
  readonly kind: string;
  readonly scope: SettingsScope;
  /** The pages of Settings where a person makes the same change — the
   * coverage guard's join key, and where Tale sends a person to finish one.
   * Empty for a kind no Settings page edits (a project's own pages do). */
  readonly areas: readonly SettingsArea[];
  /** Whether `tale config platform` and managed deployments declare it. */
  readonly cli: boolean;
  readonly ops: readonly SettingsOp[];
  /** One-shot actions on an existing resource, each named in kebab case. */
  readonly acts: readonly string[];
  /** RFC 6901 pointers into the resource's config whose value is a secret:
   * masked on every read, refused on every write. A `*` token stands for
   * any member or index. */
  readonly secretPaths: readonly string[];
  readonly baseRisk: SettingsRisk;
  /** Where its changes run among a batch's: a lower order applies first,
   * so what a resource refers to exists before it. Unique per kind. */
  readonly order: number;
  /** What it is, in agent-facing English: the settings reference
   * (`tale://docs/settings`) is built from it. */
  readonly description: string;
}

/**
 * The kinds the MCP settings tools take, in apply order. A resource's `id`
 * is its identity within its kind, as a declaration names it; a kind with
 * one resource per organization or deployment has none.
 */
export const SETTINGS_KINDS = [
  {
    kind: 'provider',
    scope: 'organization',
    areas: ['providers'],
    cli: true,
    ops: ['set', 'delete'],
    acts: ['refresh-catalogs'],
    secretPaths: [],
    baseRisk: 'high',
    order: 10,
    description:
      'An AI provider: its endpoint, API format, model catalog source and the ways its credentials may authenticate. id is the provider name.',
  },
  {
    kind: 'provider-credential',
    scope: 'organization',
    areas: ['providers'],
    cli: true,
    ops: ['set', 'delete'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 20,
    description:
      "A credential a provider's requests authenticate with, read from an environment variable of the deployment (authMethod env): its models, its status and whether it is the provider's default. id is <providerSlug>/<name>, the name URI-encoded. An API key or a subscription is entered in Tale, never here.",
  },
  {
    kind: 'governance',
    scope: 'organization',
    areas: [
      'governance/content-models',
      'governance/policies-limits',
      'governance/security-monitoring',
      'governance/guardrails',
      'sandboxes',
      'api/models',
      'enterprise-sso',
    ],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 30,
    description:
      'One organization policy, named by its key (the id), e.g. password_policy, budgets or default_models: models and model access, budgets and limits, sign-in and session security, guardrails, sandbox quotas. The retention policy and the data subject request policy change only through their own staged workflows in Tale.',
  },
  {
    kind: 'knowledge-embedding',
    scope: 'organization',
    areas: ['data-residency'],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'critical',
    order: 40,
    description:
      "The model that turns the organization's documents and crawled pages into vectors. Changing the model needs an empty knowledge base; its similarity floor and serving limits change at any time. One per organization.",
  },
  {
    kind: 'branding',
    scope: 'organization',
    areas: ['branding'],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'low',
    order: 50,
    description:
      "The organization's accent colour and the file names of its logo and favicons; the images themselves are uploaded in Tale. One per organization.",
  },
  {
    kind: 'project-instructions',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 60,
    description:
      "A project's standing instructions, which every agent working in it follows. id is the project id.",
  },
  {
    kind: 'agent-instructions',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 61,
    description: "A project agent's instructions. id is <projectId>/<agentId>.",
  },
  {
    kind: 'agent-tools',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 62,
    description:
      'The tools a project agent may use. id is <projectId>/<agentId>.',
  },
  {
    kind: 'agent-model',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 63,
    description:
      'The harness, model and provider a project agent runs on; a change applies to the runs it starts next. id is <projectId>/<agentId>.',
  },
  {
    kind: 'task-instructions',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 64,
    description:
      "A standing task's description, which its agent works from. id is <projectId>/<taskId>.",
  },
  {
    kind: 'task-review-context',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 65,
    description:
      "Whether a task's work goes to an independent review by another project agent, and which one (reviewerAgentId); the reviewer stays the same once set. A task without one reads as null. id is <projectId>/<taskId>.",
  },
  {
    kind: 'automation-approval',
    scope: 'organization',
    areas: [],
    cli: false,
    ops: [],
    acts: ['grant', 'revoke'],
    secretPaths: [],
    baseRisk: 'high',
    order: 66,
    description:
      "The writes to outside systems one automation may make without a person approving each run, named by step type (<connector>.<action>). id is the automation's name. The config is read only: allowed lists the step types allowed, used the writes the latest version makes, requiredByPolicy those a rule of the organization's approval policy still requires a person for whatever is allowed, and grants who allowed each and when. It changes through the acts grant and revoke, each taking args {types: [...]} of 1 to 50 step types; only a write to an outside system can be allowed. Owners and admins change it; developers read it.",
  },
  {
    kind: 'project-dispatch',
    scope: 'project',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'high',
    order: 67,
    description:
      "A project's dispatch, which starts its ready work on its idle agents without anyone starting each run: enabled; agents, the pool of the project's agent ids; maxConcurrentRuns, 1 to 500, and perAgentConcurrency (default 1), at most maxConcurrentRuns; statuses, the columns ready work is taken from (todo, backlog); assignment (assigned: only tasks assigned to an agent of the pool; pool: unassigned tasks go to the idle agent with the most room); rebalance (move a task that never started from a busy agent to an idle one); labels {include, exclude} by label name; admission {preset: default or conservative, the stricter host thresholds; startSpacingSeconds, default 30; recheckSeconds, default [60, 120, 240]}; and standingRoles, each {key, taskId, agentId, cron, timezone, mode, brief}, an agent started on its own task on a schedule. Only who may administer the project changes it. A project without one reads as null. id is <projectId>.",
  },
  {
    kind: 'deployment',
    scope: 'instance',
    areas: [],
    cli: true,
    ops: ['set'],
    acts: [],
    secretPaths: [],
    baseRisk: 'critical',
    order: 70,
    description:
      "This Tale deployment's own settings, shared by every organization on it, such as the sandbox runtime. Only the people its operator allows may change them, and some take effect after a restart. One per deployment.",
  },
] as const satisfies readonly SettingsKindDescriptor[];

export type SettingsKind = (typeof SETTINGS_KINDS)[number]['kind'];

/**
 * Kinds a declaration names that the MCP settings tools do not take, each
 * with the reason: the automation tools make the same change with richer
 * feedback, and one concept has one way in.
 */
export const SETTINGS_KINDS_NOT_OVER_MCP = [
  {
    kind: 'automation-definition',
    cli: true,
    reason:
      'save_automation saves the document as a new version, with its validation, tests and warnings.',
  },
  {
    kind: 'automation-deployment',
    cli: true,
    reason:
      'deploy_automation puts a saved version live, behind its tests and the version it expects to replace.',
  },
  {
    kind: 'automation-schedule',
    cli: true,
    reason:
      'set_trigger binds what starts an automation, a schedule among them.',
  },
  {
    kind: 'project',
    cli: true,
    reason:
      'A project is created in Tale, or under an id a reviewed declaration chooses; an agent finds projects with list_projects and changes their instructions and dispatch as settings.',
  },
  {
    kind: 'project-label',
    cli: true,
    reason:
      'A label is created where tasks are written, or by a reviewed declaration that keeps a project’s catalog.',
  },
  {
    kind: 'project-agent',
    cli: true,
    reason:
      'Creating a project agent and granting it connectors, secrets and skills is a person’s decision or a reviewed declaration’s, never an agent’s: an agent could otherwise hand another agent the organization’s secrets.',
  },
  {
    kind: 'task',
    cli: true,
    reason:
      'An agent creates and edits tasks with its task tools, behind each task’s own rules; a standing task under a chosen id is a reviewed declaration’s.',
  },
  {
    kind: 'agent-secret',
    cli: true,
    reason:
      'A secret’s value is read from the environment of the CLI that applies a declaration, and a person enters one in Tale; an agent never carries a secret.',
  },
  {
    kind: 'connector-credential',
    cli: true,
    reason:
      'Its secret fields are read from the environment of the CLI that applies a declaration, and a person connects an account in Tale; an agent never carries a secret.',
  },
] as const satisfies ReadonlyArray<{
  kind: string;
  cli: boolean;
  reason: string;
}>;

/**
 * Organization policies the `governance` kind does not take, each with
 * the reason an agent is told: two change through staged workflows of
 * their own in Tale, and one is retired.
 */
export const GOVERNANCE_KEYS_NOT_OVER_MCP = {
  retention_policy:
    'changes through its staged workflow in Tale, under Settings > Governance > Policies & limits',
  dsar_governance:
    'changes through its staged workflow in Tale, under Settings > Governance > Data subject requests',
  conversation_access:
    'is retired: conversation privacy is always on, and nothing reads it',
} as const satisfies Readonly<Record<string, string>>;

const BY_KIND: ReadonlyMap<string, SettingsKindDescriptor> = new Map(
  SETTINGS_KINDS.map((descriptor) => [descriptor.kind, descriptor]),
);

/** Whether the MCP settings tools take this kind. */
export function isSettingsKind(name: string): name is SettingsKind {
  return BY_KIND.has(name);
}

/** The descriptor of a kind the MCP settings tools take. */
export function settingsKindDescriptor(
  kind: SettingsKind,
): SettingsKindDescriptor {
  const descriptor = BY_KIND.get(kind);
  if (descriptor === undefined) {
    throw new Error(`No settings kind "${kind}"`);
  }
  return descriptor;
}

/** One reference token of a pointer: any character but `~` and `/`, or
 * those two escaped (`~0`, `~1`). */
const POINTER = /^(?:\/(?:[^~/]|~[01])*)+$/;

/** Whether a `secretPaths` entry is a well-formed RFC 6901 pointer below the
 * config (never the whole config, which would leave nothing to read). */
export function isSettingsPointer(pointer: string): boolean {
  return POINTER.test(pointer);
}
