/**
 * The platform MCP endpoint's tool inventory — one list, three readers.
 *
 * `backend/domains/mcp/tools.ts` answers `tools/list` from it and checks and
 * routes `tools/call` by it; the API → MCP settings section renders it. The
 * list lives here rather than in the endpoint because the settings page cannot
 * import the backend (that would pull the auth stack into the browser
 * bundle), and a hand-copied list on a screen is how a UI starts advertising
 * tools the server does not serve.
 *
 * Each tool's arguments are one zod schema (`args.ts`): the endpoint checks a
 * call against it and advertises the JSON Schema generated from it
 * (`json-schema.ts`), so what a client reads and what its call meets are the
 * same rule.
 */

import type { z } from 'zod';

import { METHODS, type Method } from '../engine/api/methods';
import {
  CAPABILITY_TOOL_ARGS,
  ENGINE_TOOL_ARGS,
  PLATFORM_TOOL_ARGS,
} from './args';
import { READ_TOOL_RESULTS } from './results';

/** The groups the inventory is presented in — the settings page and the
 * docs tables both read the list in this order. */
export const MCP_TOOL_GROUPS = [
  'authoring',
  'management',
  'discovery',
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
 * it and who may call it — the endpoint routes on `kind` and gates on
 * `role`; the settings page groups on `group`. */
export interface McpToolSpec {
  readonly name: string;
  readonly description: string;
  /** The arguments, checked on every call; `tools/list` advertises the JSON
   * Schema generated from it. */
  readonly args: z.ZodObject;
  readonly annotations: McpToolAnnotations;
  /** `engine` goes to the automation engine's dispatch table; `platform` to
   * the platform's own reads (`backend/domains/mcp/platform-tools.ts`);
   * `capability` to the organization's capability surface. */
  readonly kind: 'engine' | 'platform' | 'capability';
  readonly group: McpToolGroup;
  /** Who may call it, checked before it runs: `developer` takes the owner,
   * admin or developer role (the in-app equivalent's bar); `member` leaves it
   * to the surface's own rules; `live-developer` takes the developer bar for
   * a live call (`mode: "live"`, the default) and leaves a mock one to every
   * member. A tool a role cannot use stays listed. */
  readonly role: 'member' | 'developer' | 'live-developer';
  /** The budget a call draws from once its role check passed: `api` only
   * the request the door already charged; `execute` also one execution
   * (`rest:execute`, the REST API's run-start budget). */
  readonly lane: 'api' | 'execute';
  /** What every answer that is not a refusal carries — read tools only:
   * `tools/list` advertises it as the `outputSchema`, and the answer carries
   * it as `structuredContent` beside the same JSON as text. */
  readonly result: z.ZodObject | null;
  /** Whether a client must ask the person before every call, even where it
   * otherwise runs tools without asking (Claude Code honours
   * `_meta["anthropic/requiresUserInteraction"]`): going live is the
   * person's call. */
  readonly requiresUserInteraction: boolean;
  /** How large an answer a client should keep inline
   * (`_meta["anthropic/maxResultSizeChars"]`) — the tools whose answers run
   * past a client's default cap. */
  readonly maxResultChars?: number;
}

/** Tools that put a version live, decide what starts one or where it runs,
 * remove one, or speak for a person: a client asks the person before each
 * call, whatever its permission mode. */
const ASK_FIRST_TOOLS: ReadonlySet<string> = new Set([
  'deploy_automation',
  'delete_automation',
  'set_trigger',
  'answer_run_ask',
  'set_automation_projects',
]);

/** The tools whose answers run long — the reference, the catalog, an
 * analysis with its inferred types, a run's trace — and the size a client
 * keeps inline instead of cutting or saving it to a file. */
const MAX_RESULT_CHARS: Readonly<Record<string, number>> = {
  get_docs: 100_000,
  get_catalog: 250_000,
  validate_automation: 200_000,
  run_automation: 200_000,
  get_automation: 200_000,
  run_deployed: 200_000,
  get_run: 500_000,
  get_run_node: 300_000,
  compare_runs: 500_000,
};

const RESULTS: ReadonlyMap<string, z.ZodObject> = new Map(
  Object.entries(READ_TOOL_RESULTS),
);

type ContractFields =
  | 'lane'
  | 'result'
  | 'requiresUserInteraction'
  | 'maxResultChars';

/** A tool with what the inventory says of it beyond its surface and
 * arguments: its budget, its answer, and the client hints. */
function withContract(spec: Omit<McpToolSpec, ContractFields>): McpToolSpec {
  const maxResultChars = MAX_RESULT_CHARS[spec.name];
  return Object.assign(spec, {
    lane: EXECUTE_TOOLS.has(spec.name)
      ? ('execute' as const)
      : ('api' as const),
    result: RESULTS.get(spec.name) ?? null,
    requiresUserInteraction: ASK_FIRST_TOOLS.has(spec.name),
    ...(maxResultChars === undefined ? {} : { maxResultChars }),
  });
}

/** Tools whose in-app equivalents sit behind the developer capability —
 * persisting or rebinding an automation, starting or stopping a live run —
 * so a key meets the same bar here. Live execution is also checked by the
 * store; the check here comes first, so a refused call spends nothing. */
const DEVELOPER_TOOLS: ReadonlySet<string> = new Set([
  'save_automation',
  'deploy_automation',
  'delete_automation',
  'set_trigger',
  'run_deployed',
  'cancel_run',
  'set_automation_projects',
  'delete_trigger',
]);

/** Tools whose live call takes the developer bar and whose mock call is
 * every member's: a mock start reaches nothing outside Tale, the app's own
 * rule for its run button. */
const LIVE_DEVELOPER_TOOLS: ReadonlySet<string> = new Set(['start_run']);

function engineRole(name: Method): McpToolSpec['role'] {
  if (DEVELOPER_TOOLS.has(name)) return 'developer';
  return LIVE_DEVELOPER_TOOLS.has(name) ? 'live-developer' : 'member';
}

/** Tools that execute an automation — a run on the mocks, its tests, the
 * deploy gate's tests, a live run, a capability, the answer a waiting run
 * resumes on — and draw from the same execution budget the REST API's run
 * starts and run answers do: a key whose budget is spent is refused on
 * both doors alike. */
const EXECUTE_TOOLS: ReadonlySet<string> = new Set([
  'run_automation',
  'test_automation',
  'deploy_automation',
  'run_deployed',
  'start_run',
  'answer_run_ask',
  'invoke_capability',
]);

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

/** A removal that cannot be undone: every version of an automation. */
const DELETE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** An answer in a person's name: the run resumes on it, and a second answer
 * to the same question is refused. */
const ANSWER: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
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
  delete_automation: DELETE,
  set_trigger: REPLACE,
  run_deployed: EXECUTE_LIVE,
  start_run: EXECUTE_LIVE,
  list_runs: READ,
  get_run: READ,
  get_run_node: READ,
  compare_runs: READ,
  cancel_run: REPLACE,
  answer_run_ask: ANSWER,
  list_versions: READ,
  set_automation_projects: REPLACE,
  list_triggers: READ,
  delete_trigger: REPLACE,
};

/** One-line tool descriptions; `get_docs` is the deep reference. */
const METHOD_DESCRIPTIONS: Record<Method, string> = {
  get_docs:
    'The automation grammar and authoring guide, as text — or, with topic, the triggers reference, the validation reference or the Tale skill.',
  get_catalog: 'Every node type this deployment can execute.',
  search_catalog: 'Search the node-type catalog by keyword.',
  validate_automation:
    'Validate an automation document without saving it: its errors and warnings, each with a code, a location and params, plus the flow analysis and the inferred types.',
  run_automation:
    'Run an automation document directly against the deterministic mocks.',
  test_automation:
    "Run an automation's own acceptance tests — of a draft (automation), or of a saved version (name, version), whose verdict is then recorded on it.",
  save_automation:
    'Save an automation document as a new immutable version; the answer lists its warnings. Pass baseVersion (the version you read) so a version saved meanwhile is never overwritten. Settings, task contract and presentation you leave out are kept from the latest version (carried names them).',
  get_automation:
    'Read one saved version (the latest when unversioned): the document, its settings, task contract and presentation, latestVersion, deployedVersion, who saved it and through which door, its installations and its trigger.',
  list_automations:
    "The organization's automations with their latest and deployed versions and the projects each is installed in (projectIds).",
  deploy_automation:
    'Promote one saved version to be the live version; an older one rolls back. Pass expectedDeployedVersion so another deploy meanwhile is never replaced; the answer names the previousVersion.',
  delete_automation:
    'Delete an automation: every version, its trigger and its installations; the run history stays. expectedLatestVersion must be the latest version you read.',
  set_trigger: 'Bind what starts the automation (schedule/webhook/event).',
  run_deployed:
    'Run the deployed version live and WAIT for the finished result — output, trace and effects in one answer; a run that outlives the wait answers with its runId to poll via get_run. For a project-bound automation, use a host pinned to that project or start_run with projectId.',
  start_run:
    'Start a run in the background and return a run handle immediately; poll get_run for the result. mode "live" (default) runs the deployed version for real; mode "mock" runs any saved version against the mocks and is recorded — use it while testing.',
  list_runs:
    'Recent runs the caller can read, newest first — of one automation or of the current scope; filter by mode and statuses, and page with nextCursor.',
  get_run:
    'One run in full: status, output, trace and effects (detail: [] answers the status alone — poll with it). include: ["record"] adds the run step by step — why each step ran, was skipped or failed, each condition explained with the values it read. A run waiting on a person\'s answer (waitingFor: "ask") names the question under ask: its askId and the question, for answer_run_ask.',
  get_run_node:
    "One step of a run read whole — or one of its items or passes: what it received and returned (secrets withheld), where its templates' text landed, what it read from earlier steps, how its output differs from its input, and its call to a connector or a model.",
  compare_runs:
    'Two runs of one automation side by side, step by step: what changed in the version, how input and output differ, and the first step where the runs went different ways — the decision that flipped and the values that flipped it.',
  cancel_run: 'Stop a run at its next node boundary.',
  answer_run_ask:
    'Answer the question a waiting run asked a person (get_run answers it as run.ask: askId and question); the run resumes on the answer. The answer speaks for the person: ask them first.',
  list_versions:
    "One automation's immutable version history — who saved each version through which door — and when each version went live (deployments).",
  set_automation_projects:
    'Install an automation in projects (add) and remove it from others (remove), in one change.',
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
  delete_automation: 'authoring',
  set_trigger: 'management',
  run_deployed: 'management',
  start_run: 'management',
  list_runs: 'management',
  get_run: 'management',
  get_run_node: 'management',
  compare_runs: 'management',
  cancel_run: 'management',
  answer_run_ask: 'management',
  list_versions: 'management',
  set_automation_projects: 'management',
  list_triggers: 'management',
  delete_trigger: 'management',
};

/** The platform tools — answered by the platform from its own records, not
 * by the engine's method table. */
const PLATFORM_TOOLS = [
  {
    name: 'get_automation_metrics',
    description:
      "The organization's run figures for a window: runs by outcome, success rate, average duration, a per-day series and the busiest automations, each against the window before.",
    annotations: READ,
    group: 'management',
  },
  {
    name: 'list_models',
    description:
      'The models you may use in a step: each with its provider (an agent step saves both as model and modelProvider), whether a provider serves it directly or a subscription does, the step types it suits and the agent runtimes it is offered to.',
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_harnesses',
    description:
      'The agent runtimes an agent step can run on (its harness), which one runs when a step names none, and which a subscription can serve.',
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_skills',
    description:
      "The skills an agent step can equip: the organization's own, or with projectId also the team skills of that project.",
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_connectors',
    description:
      'The connectors this deployment offers and whether the organization connected each — an agent step equips them by slug, a step running one of their actions needs it connected.',
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_agent_secrets',
    description:
      "The names of the organization's agent secrets an agent step can ask for, with a masked preview — never a value. Only owners, admins and developers see them; anyone else gets an empty list.",
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_projects',
    description:
      'The projects you can read: whether you can edit each, whether it is archived, and the automations installed in it.',
    annotations: READ,
    group: 'discovery',
  },
  {
    name: 'list_events',
    description:
      'The events Tale raises, which an event trigger can wait for, each with when it fires.',
    annotations: READ,
    group: 'discovery',
  },
] as const satisfies ReadonlyArray<{
  name: keyof typeof PLATFORM_TOOL_ARGS;
  description: string;
  annotations: McpToolAnnotations;
  group: McpToolGroup;
}>;

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
    'Invoke one capability by id: a deployed automation, run live as run_deployed runs it. A step the organization gates for approval leaves the run waiting for a person to decide in Tale (get_run shows waitingFor: "approval"); no tool decides an approval, so tell the person instead of retrying.',
  get_knowledge:
    "Retrieve passages from the organization's knowledge — its documents and its crawled web pages.",
};

const CAPABILITY_TOOL_ANNOTATIONS: Record<
  CapabilityToolName,
  McpToolAnnotations
> = {
  search_capabilities: READ,
  invoke_capability: EXECUTE_LIVE,
  get_knowledge: READ,
};

/**
 * Every tool this endpoint serves, in the order it advertises them: the engine's
 * method table first (authoring, then management, exactly as the engine lists
 * them), then the platform's own reads (its management read, then
 * discovery), then the capability tools.
 */
export const MCP_TOOLS: readonly McpToolSpec[] = [
  ...METHODS.map((name) =>
    withContract({
      name,
      description: METHOD_DESCRIPTIONS[name],
      args: ENGINE_TOOL_ARGS[name],
      annotations: METHOD_ANNOTATIONS[name],
      kind: 'engine',
      group: METHOD_GROUPS[name],
      role: engineRole(name),
    }),
  ),
  ...PLATFORM_TOOLS.map((tool) =>
    withContract({
      name: tool.name,
      description: tool.description,
      args: PLATFORM_TOOL_ARGS[tool.name],
      annotations: tool.annotations,
      kind: 'platform',
      group: tool.group,
      role: 'member',
    }),
  ),
  ...CAPABILITY_TOOL_NAMES.map((name) =>
    withContract({
      name,
      description: CAPABILITY_TOOL_DESCRIPTIONS[name],
      args: CAPABILITY_TOOL_ARGS[name],
      annotations: CAPABILITY_TOOL_ANNOTATIONS[name],
      kind: 'capability',
      group: 'capability',
      role: 'member',
    }),
  ),
];

/** The tool of that name, if the inventory holds one. */
export function findMcpTool(name: string): McpToolSpec | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
