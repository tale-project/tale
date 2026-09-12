/**
 * The platform MCP endpoint's tool inventory — one list, three readers.
 *
 * `convex/automations_builder/mcp_http.ts` answers `tools/list` from it and
 * routes `tools/call` by it; the API → MCP settings section renders it. The
 * list lives here rather than in the endpoint because the settings page cannot
 * import a Convex HTTP module (that would pull the auth stack into the browser
 * bundle), and a hand-copied list on a screen is how a UI starts advertising
 * tools the server does not serve.
 *
 * One schema policy: every tool declares a REAL schema, and the endpoint
 * holds a call to it — a mismatch is -32602, never a silently "successful"
 * call that ran nothing — with `additionalProperties: false`, so a typo is
 * an error instead of a silently ignored field. The four methods that take
 * an AUTOMATION DOCUMENT (validate, run, test, save) declare their call
 * envelope (`{automation, …}`) and leave the document itself an open object:
 * its node grammar is a page of rules the engine teaches in band
 * (`get_docs`) and validates itself, and a JSON Schema copy here would be a
 * second source of truth that drifts.
 */

import { METHODS, type Method } from '../engine/api/dispatch';

/** The three groups the inventory is presented in — the settings page and the
 * docs table both read the list in this order. */
export const MCP_TOOL_GROUPS = [
  'authoring',
  'management',
  'capability',
] as const;

export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

/**
 * The MCP `ToolAnnotations` a host keys its "always allow" decisions on —
 * hints, never guarantees, but the one machine-readable signal that tells
 * `get_run` from `delete_trigger` in an otherwise flat inventory.
 */
export interface McpToolAnnotations {
  /** The tool changes nothing. */
  readonly readOnlyHint: boolean;
  /** The tool may destroy or irreversibly alter what exists (meaningful
   * when `readOnlyHint` is false). */
  readonly destructiveHint: boolean;
  /** Repeating the call with the same arguments has no further effect
   * (meaningful when `readOnlyHint` is false). */
  readonly idempotentHint: boolean;
  /** The tool reaches outside the platform — live connectors, the web. */
  readonly openWorldHint: boolean;
}

/** One tool exactly as `tools/list` advertises it, plus which surface answers
 * it — the endpoint routes on `kind`; the settings page groups on `group`. */
interface McpToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: McpToolAnnotations;
  /** `engine` goes to the automation engine's dispatch table; `capability` goes
   * to the organization's capability surface. */
  readonly kind: 'engine' | 'capability';
  readonly group: McpToolGroup;
}

/** A read: changes nothing, repeats freely, stays inside the platform. */
const READ: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** A write that adds without destroying and is not idempotent (each call
 * mints a new version). */
const APPEND: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** A write that replaces or removes what exists, and lands the same state
 * however often it is repeated. */
const REPLACE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Live execution: every call runs the automation again, against real
 * backends, with whatever effects that has. */
const EXECUTE_LIVE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/** Execution against the deterministic mocks: a run, but one that reaches
 * nothing outside and leaves nothing behind. */
const EXECUTE_MOCK: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Every engine method's annotations — exhaustive over `Method`, so a new
 * method cannot ship without saying what it does to the world. */
const METHOD_ANNOTATIONS: Record<Method, McpToolAnnotations> = {
  get_docs: READ,
  get_catalog: READ,
  search_catalog: READ,
  validate_automation: READ,
  run_automation: EXECUTE_MOCK,
  test_automation: EXECUTE_MOCK,
  save_automation: APPEND,
  get_automation: READ,
  list_automations: READ,
  deploy_automation: REPLACE,
  set_trigger: REPLACE,
  run_deployed: EXECUTE_LIVE,
  start_run: EXECUTE_LIVE,
  list_runs: READ,
  get_run: READ,
  cancel_run: REPLACE,
  list_versions: READ,
  list_triggers: READ,
  delete_trigger: REPLACE,
};

/** One-line tool descriptions; `get_docs` is the deep reference. */
const METHOD_DESCRIPTIONS: Record<Method, string> = {
  get_docs: 'The automation grammar and authoring guide, as text.',
  get_catalog: 'Every node type this deployment can execute.',
  search_catalog: 'Search the node-type catalog by keyword.',
  validate_automation: 'Validate an automation document without saving it.',
  run_automation:
    'Run an automation document directly against the deterministic mocks.',
  test_automation: "Run an automation's own acceptance tests.",
  save_automation: 'Save an automation document as a new immutable version.',
  get_automation: 'Read one saved version (the latest when unversioned).',
  list_automations:
    "The organization's automations with their latest versions.",
  deploy_automation: 'Promote one saved version to be the live version.',
  set_trigger: 'Bind what starts the automation (schedule/webhook/event).',
  run_deployed:
    'Run the deployed version live and WAIT for the finished result — output, trace and effects in one answer; a run that outlives the wait answers with its runId to poll via get_run. For a project-bound automation, use a host pinned to that project or start_run with projectId.',
  start_run:
    'Start the deployed version in the background and return a run handle immediately; poll get_run for the result.',
  list_runs:
    'Recent runs the caller can read, newest first — of one automation or of the current scope.',
  get_run: 'One run in full: status, output, trace and effects.',
  cancel_run: 'Stop a run at its next node boundary.',
  list_versions: "One automation's immutable version history.",
  list_triggers: 'What starts the automations (never the webhook secret).',
  delete_trigger:
    "Unbind an automation's trigger; its versions and run history stay.",
};

/** The engine methods split into the two groups the docs table draws: the
 * AUTHORING methods work on automation documents, the MANAGEMENT methods on
 * what the host has persisted — runs, versions and triggers (`set_trigger`
 * writes one, so it belongs with the trigger management, not the authoring
 * loop). Exhaustive over `Method`, so a new engine method cannot ship
 * unclassified. */
const METHOD_GROUPS: Record<Method, Exclude<McpToolGroup, 'capability'>> = {
  get_docs: 'authoring',
  get_catalog: 'authoring',
  search_catalog: 'authoring',
  validate_automation: 'authoring',
  run_automation: 'authoring',
  test_automation: 'authoring',
  save_automation: 'authoring',
  get_automation: 'authoring',
  list_automations: 'authoring',
  deploy_automation: 'authoring',
  set_trigger: 'management',
  run_deployed: 'management',
  start_run: 'management',
  list_runs: 'management',
  get_run: 'management',
  cancel_run: 'management',
  list_versions: 'management',
  list_triggers: 'management',
  delete_trigger: 'management',
};

/** The capability tools — NOT engine methods. They reach the organization's own
 * capability registry and knowledge base, which is a different surface with a
 * different backend, so they are named and described separately. */
const CAPABILITY_TOOL_NAMES = [
  'search_capabilities',
  'invoke_capability',
  'get_knowledge',
] as const;

type CapabilityToolName = (typeof CAPABILITY_TOOL_NAMES)[number];

const CAPABILITY_TOOL_DESCRIPTIONS: Record<CapabilityToolName, string> = {
  search_capabilities:
    'Search everything this organization can do — its deployed automations, by name and description.',
  invoke_capability:
    'Invoke one capability by id. An action the organization gates returns a pending-approval result instead of running.',
  get_knowledge:
    "Retrieve passages from the organization's knowledge — its documents and its crawled web pages.",
};

function object(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required: [...required] }),
    additionalProperties: false,
  };
}

const AUTOMATION_NAME: Record<string, unknown> = {
  type: 'string',
  description:
    'The automation name — a "/"-separated path, e.g. "billing/dunning-reminder".',
};

const RUN_ID: Record<string, unknown> = {
  type: 'string',
  description: 'The run handle start_run and list_runs return.',
};

const SAVED_VERSION: Record<string, unknown> = {
  type: 'integer',
  minimum: 1,
  description: 'A saved version number — list_versions shows them.',
};

/** No `type`: an automation's own `inputs` schema may be an array or a
 * scalar, and the engine validates the value against it — the tool schema
 * only says where the input goes. */
const RUN_INPUT: Record<string, unknown> = {
  description:
    "The run's input — any JSON value the automation's own inputs schema accepts; the engine validates it.",
};

/** The automation document itself. Its node grammar is the page of rules
 * `get_docs` teaches and the engine validates in band — a JSON Schema copy
 * here would be a second source of truth that drifts — so the document is
 * an open object; what IS declared is the call envelope around it. */
const AUTOMATION_DOCUMENT: Record<string, unknown> = {
  type: 'object',
  description:
    'The automation document — name, inputs, nodes, output, tests. get_docs is the grammar; the engine validates it and answers with the problems.',
};

/** Real schemas for every tool: the four automation-document methods
 * declare their call envelope (`{automation, …}`) around the open document,
 * so a call without the document is refused at the transport (-32602)
 * rather than answered with a hint in another dialect. */
const METHOD_SCHEMAS: Partial<Record<Method, Record<string, unknown>>> = {
  get_docs: object({}),
  get_catalog: object({
    kind: {
      type: 'string',
      enum: ['transform', 'llm', 'agent', 'subautomation', 'connector'],
      description: 'Only node types of this kind.',
    },
    compact: {
      type: 'boolean',
      description:
        'Names and descriptions only — no input schemas. The full catalog is large (over 100 KB); prefer search_catalog or compact for discovery.',
    },
  }),
  validate_automation: object({ automation: AUTOMATION_DOCUMENT }, [
    'automation',
  ]),
  run_automation: object(
    {
      automation: AUTOMATION_DOCUMENT,
      input: RUN_INPUT,
      mode: {
        type: 'string',
        enum: ['mock', 'live'],
        description: 'mock (default) runs against deterministic mocks.',
      },
    },
    ['automation'],
  ),
  test_automation: object({ automation: AUTOMATION_DOCUMENT }, ['automation']),
  save_automation: object(
    {
      automation: AUTOMATION_DOCUMENT,
      message: {
        type: 'string',
        description: 'Why this version — shown in the version history.',
      },
    },
    ['automation'],
  ),
  search_catalog: object(
    {
      query: {
        type: 'string',
        description:
          'Capability keywords — verbs and objects, e.g. "send email".',
      },
    },
    ['query'],
  ),
  get_automation: object(
    {
      name: AUTOMATION_NAME,
      version: {
        ...SAVED_VERSION,
        description: 'Read this saved version instead of the latest one.',
      },
    },
    ['name'],
  ),
  list_automations: object({}),
  deploy_automation: object(
    {
      name: AUTOMATION_NAME,
      version: {
        ...SAVED_VERSION,
        description: 'The saved version to promote — list_versions shows them.',
      },
    },
    ['name', 'version'],
  ),
  set_trigger: object(
    {
      name: AUTOMATION_NAME,
      trigger: {
        type: 'object',
        description:
          'The trigger — {kind: "schedule" | "webhook" | "event", …}; get_docs describes each kind.',
      },
    },
    ['name', 'trigger'],
  ),
  run_deployed: object({ name: AUTOMATION_NAME, input: RUN_INPUT }, ['name']),
  start_run: object(
    {
      name: AUTOMATION_NAME,
      input: RUN_INPUT,
      version: {
        ...SAVED_VERSION,
        description:
          'Run this exact version instead of the deployed one. Rarely needed.',
      },
      projectId: {
        type: 'string',
        description:
          'The project the run operates in — its task and document tools act there. The caller must have edit access to this active project. Omit only for an organization-wide automation or when the host already pins a project. A bound automation requires an explicit allowed project.',
      },
    },
    ['name'],
  ),
  list_runs: object({
    name: {
      ...AUTOMATION_NAME,
      description:
        "Only this automation's runs. Omit for every run the caller can read in the current scope.",
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      description: 'How many runs to return (default 50).',
    },
  }),
  get_run: object({ runId: RUN_ID }, ['runId']),
  cancel_run: object({ runId: RUN_ID }, ['runId']),
  list_versions: object({ name: AUTOMATION_NAME }, ['name']),
  list_triggers: object({
    name: {
      ...AUTOMATION_NAME,
      description:
        "Only this automation's trigger. Omit for every trigger in the organization.",
    },
  }),
  delete_trigger: object({ name: AUTOMATION_NAME }, ['name']),
};

const CAPABILITY_TOOL_ANNOTATIONS: Record<
  CapabilityToolName,
  McpToolAnnotations
> = {
  search_capabilities: READ,
  invoke_capability: EXECUTE_LIVE,
  get_knowledge: READ,
};

const CAPABILITY_TOOL_SCHEMAS: Record<
  CapabilityToolName,
  Record<string, unknown>
> = {
  search_capabilities: object(
    {
      query: {
        type: 'string',
        description: 'What you want to do, in the words a person would use.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'How many matches to return (default 8).',
      },
    },
    ['query'],
  ),
  invoke_capability: object(
    {
      id: {
        type: 'string',
        description:
          'The capability id from search_capabilities, e.g. "automation.billing/dunning-reminder".',
      },
      input: {
        description:
          "Arguments — any JSON value the capability's own input schema accepts; the surface validates them.",
      },
      credential: {
        type: 'string',
        description:
          "Which stored credential to act as. Omit to use the organization's default.",
      },
    },
    ['id'],
  ),
  get_knowledge: object(
    {
      query: {
        type: 'string',
        description: 'What to look for, in the words a person would use.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'How many passages to return (default 10).',
      },
      corpus: {
        type: 'string',
        enum: ['private', 'public-web', 'all'],
        description:
          "Which knowledge to search: the organization's own documents, its crawled web pages, or both. Default 'all'.",
      },
    },
    ['query'],
  ),
};

/**
 * Every tool this endpoint serves, in the order it advertises them: the engine's
 * method table first (authoring, then management, exactly as the engine lists
 * them), then the platform capability tools.
 */
export const MCP_TOOLS: readonly McpToolSpec[] = [
  ...METHODS.map((name) => {
    const inputSchema = METHOD_SCHEMAS[name];
    if (inputSchema === undefined) {
      throw new Error(`MCP tool "${name}" has no input schema`);
    }
    return {
      name,
      description: METHOD_DESCRIPTIONS[name],
      inputSchema,
      annotations: METHOD_ANNOTATIONS[name],
      kind: 'engine' as const,
      group: METHOD_GROUPS[name],
    };
  }),
  ...CAPABILITY_TOOL_NAMES.map((name) => ({
    name,
    description: CAPABILITY_TOOL_DESCRIPTIONS[name],
    inputSchema: CAPABILITY_TOOL_SCHEMAS[name],
    annotations: CAPABILITY_TOOL_ANNOTATIONS[name],
    kind: 'capability' as const,
    group: 'capability' as const,
  })),
];
