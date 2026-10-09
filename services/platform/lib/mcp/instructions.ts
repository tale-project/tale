import { MCP_TOOLS } from './tools';

/**
 * The server instructions `initialize` answers: what this server is for and
 * how to work with it, which a client puts in front of its model (Claude
 * Code reads them to find Tale's tools when it searches its tools instead of
 * loading them all). Agent-facing English, a public API like the tool
 * descriptions.
 *
 * Assembled from fragments that each name the tools they mention, and a
 * fragment ships only when every one of its tools is in the inventory: a
 * later tool's sentence is written beside the tool, never ahead of it, so
 * the text is true at every release. The guard (`instructions.test.ts`)
 * holds the limits clients apply — Claude Code keeps the first 2,048
 * characters — and that every tool name a fragment mentions exists.
 */
export interface InstructionFragment {
  /** The text: the first fragment is the opening paragraph, every other one
   * a line of its own. */
  readonly text: string;
  /** Every tool the text names. */
  readonly tools: readonly string[];
}

export const INSTRUCTION_FRAGMENTS: readonly InstructionFragment[] = [
  {
    text: "Tale server: read, change, check, test, save and deploy this organization's automations (node graphs started by schedules, webhooks, events or on demand), and run and debug them. Loop: get_automation -> edit -> validate_automation (fix every error) -> run_automation with a realistic input (mocks; nothing leaves Tale) -> test_automation -> save_automation with a message. Ask the person before deploy_automation.",
    tools: [
      'get_automation',
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
      'deploy_automation',
    ],
  },
  {
    text: 'Read get_docs (tale://docs/authoring) once before you write; its topics "triggers" and "validation" answer those. search_catalog and get_catalog list the node types this deployment runs.',
    tools: ['get_docs', 'search_catalog', 'get_catalog'],
  },
  {
    text: 'Name only what exists: list_models, list_harnesses, list_skills, list_connectors, list_agent_secrets, list_projects and list_events say what this organization has; validate_automation warns about the rest.',
    tools: [
      'list_models',
      'list_harnesses',
      'list_skills',
      'list_connectors',
      'list_agent_secrets',
      'list_projects',
      'list_events',
      'validate_automation',
    ],
  },
  {
    text: 'A refusal is data {error, code, hint}: branch on code, follow hint; invalid arguments list every issue at once.',
    tools: [],
  },
  {
    text: 'Never overwrite: save_automation with baseVersion (the version you read), or create: true for a new automation; deploy_automation with expectedDeployedVersion. A refusal names the newer version to read and merge. Fields a save leaves out are kept.',
    tools: ['save_automation', 'deploy_automation'],
  },
  {
    text: 'Live means real effects: run_deployed, start_run, deploy_automation and set_trigger act for real. run_automation, test_automation and start_run with mode "mock" use the mocks; a mock start is recorded for the person to see.',
    tools: [
      'run_deployed',
      'start_run',
      'deploy_automation',
      'set_trigger',
      'run_automation',
      'test_automation',
    ],
  },
  {
    text: 'Approvals are human-only; never try to decide one.',
    tools: [],
  },
  {
    text: "Settings: get_settings -> plan_settings -> show the plan -> apply_settings with each resource's expected hash.",
    tools: ['get_settings', 'plan_settings', 'apply_settings'],
  },
  {
    text: "A failed run: read it with get_run, fix the document, reproduce with run_automation and the run's input.",
    tools: ['get_run', 'run_automation'],
  },
];

/** The instructions for an inventory: the fragments whose tools it holds. */
export function buildInstructions(
  inventory: ReadonlySet<string>,
  fragments: readonly InstructionFragment[] = INSTRUCTION_FRAGMENTS,
): string {
  const [opening, ...lines] = fragments.filter((fragment) =>
    fragment.tools.every((tool) => inventory.has(tool)),
  );
  if (opening === undefined) return '';
  return [
    opening.text,
    ...(lines.length > 0 ? ['', ...lines.map((line) => line.text)] : []),
  ].join('\n');
}

/** What `initialize` answers as `instructions`. */
export const SERVER_INSTRUCTIONS = buildInstructions(
  new Set(MCP_TOOLS.map((tool) => tool.name)),
);
