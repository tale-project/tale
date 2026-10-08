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
    text: 'Grammar: call get_docs once per session before you write a document. Discover instead of guessing: search_catalog and get_catalog list the node types this deployment can run.',
    tools: ['get_docs', 'search_catalog', 'get_catalog'],
  },
  {
    text: 'Every refusal is data {error, code, hint}: branch on code, follow hint. Invalid arguments list every issue at once. RATE_LIMITED says how long to wait.',
    tools: [],
  },
  {
    text: 'Live means real effects: run_deployed, start_run, deploy_automation and set_trigger act for real; run_automation and test_automation use mocks.',
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
    text: "A failed run: get_run, read its status, error and trace, fix the document, reproduce with run_automation and the run's input.",
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
