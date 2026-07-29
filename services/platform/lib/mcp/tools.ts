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
 * Two schema policies, on purpose:
 *
 *  - the AUTHORING methods keep an OPEN schema (`{type: 'object'}`). Their one
 *    real argument is an automation document, whose grammar is a page of rules
 *    the engine teaches in band: it validates the params itself and refuses with
 *    an actionable hint, and `get_docs` is the reference. A JSON Schema copy of
 *    the node grammar here would be a second source of truth that drifts.
 *  - the MANAGEMENT and CAPABILITY tools declare REAL schemas. Their arguments
 *    are a name, a handle, a query — a client can and should be told the shape,
 *    and `additionalProperties: false` turns a typo into a client-side error
 *    instead of a silently ignored field.
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

/** One tool exactly as `tools/list` advertises it, plus which surface answers
 * it — the endpoint routes on `kind`; the settings page groups on `group`. */
interface McpToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** `engine` goes to the automation engine's dispatch table; `capability` goes
   * to the organization's capability surface. */
  readonly kind: 'engine' | 'capability';
  readonly group: McpToolGroup;
}

/** One-line tool descriptions; `get_docs` is the deep reference. */
const METHOD_DESCRIPTIONS: Record<Method, string> = {
  get_docs: 'The automation grammar and authoring guide, as text.',
  get_catalog: 'Every node type this deployment can execute.',
  search_catalog: 'Search the node-type catalog by keyword.',
  validate_automation: 'Validate an automation document without saving it.',
  run_automation: 'Run an automation document directly (mock or live mode).',
  test_automation: "Run an automation's own acceptance tests.",
  save_automation: 'Save an automation document as a new immutable version.',
  get_automation: 'Read one saved version (the latest when unversioned).',
  list_automations:
    "The organization's automations with their latest versions.",
  deploy_automation: 'Promote one saved version to be the live version.',
  set_trigger: 'Bind what starts the automation (schedule/webhook/event).',
  run_deployed:
    'Run the deployed version and WAIT for the finished result — output, trace and effects in one answer.',
  start_run:
    'Start the deployed version in the background and return a run handle immediately; poll get_run for the result.',
  list_runs:
    'Recent runs, newest first — of one automation or of the whole organization.',
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
    'Search everything this organization can do — its automations, connector actions, skills and tools.',
  invoke_capability:
    'Invoke one capability by id. An action the organization gates returns a pending-approval result instead of running.',
  get_knowledge:
    "Retrieve passages from the organization's knowledge — its documents and its crawled web pages.",
};

/** The engine validates and teaches its own params; `get_docs` is the schema. */
const OPEN_SCHEMA: Record<string, unknown> = { type: 'object' };

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

/** Real schemas for the tools whose arguments are simple. Anything absent here
 * keeps the open schema. */
const METHOD_SCHEMAS: Partial<Record<Method, Record<string, unknown>>> = {
  start_run: object(
    {
      name: AUTOMATION_NAME,
      input: {
        type: 'object',
        description:
          "The run's input, matching the automation's inputs schema.",
      },
      version: {
        type: 'integer',
        minimum: 1,
        description:
          'Run this exact version instead of the deployed one. Rarely needed.',
      },
    },
    ['name'],
  ),
  list_runs: object({
    name: {
      ...AUTOMATION_NAME,
      description:
        "Only this automation's runs. Omit for the whole organization.",
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
        type: 'object',
        description: "Arguments, matching the capability's own input schema.",
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
  ...METHODS.map((name) => ({
    name,
    description: METHOD_DESCRIPTIONS[name],
    inputSchema: METHOD_SCHEMAS[name] ?? OPEN_SCHEMA,
    kind: 'engine' as const,
    group: METHOD_GROUPS[name],
  })),
  ...CAPABILITY_TOOL_NAMES.map((name) => ({
    name,
    description: CAPABILITY_TOOL_DESCRIPTIONS[name],
    inputSchema: CAPABILITY_TOOL_SCHEMAS[name],
    kind: 'capability' as const,
    group: 'capability' as const,
  })),
];

/** Which surface answers a tool name, or `undefined` when nothing does. */
export function mcpToolKind(name: string): McpToolSpec['kind'] | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name)?.kind;
}
