import { z } from 'zod';

import { automationResourceUri, runResourceUri } from './resources';
import { MCP_TOOLS } from './tools';

/**
 * The MCP endpoint's prompts — ready-made requests a person picks in their
 * client (Claude Code lists them as `/tale:<name>`) to start a common piece
 * of work: edit an automation, explain a failed run, add a trigger. Each one
 * is a user message that walks the agent through the loop the server
 * instructions teach, with the automation, the run or the reference it is
 * about embedded, read with the caller's own rights
 * (`backend/domains/mcp/prompts.ts`).
 *
 * Claude Code splits a prompt's arguments on whitespace, so every argument
 * is one token — a name, a run id, a kind — and none carries free text: what
 * to change comes from the conversation.
 *
 * Like the server instructions, a message is built from lines that each
 * name the tools they mention, and a line ships only when its tools are in
 * the inventory; a prompt whose `requiredTools` are not all there is not
 * listed. The guard (`prompts.test.ts`) holds both, and that every
 * `tale://` address a message names exists.
 */

/** A prompt's arguments once checked: each a one-word string, or absent. */
export type PromptArgs = Readonly<Record<string, string | undefined>>;

/** One argument as `prompts/list` advertises it. */
export interface McpPromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

/** One line of a prompt's message and the tools it names. */
export interface PromptLine {
  readonly text: string;
  readonly tools: readonly string[];
}

/** A resource a prompt embeds: `required` ones must read, or the prompt is
 * refused; an optional one is left out when it does not. */
export interface PromptEmbed {
  readonly uri: string;
  readonly required: boolean;
}

export interface McpPromptSpec {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly McpPromptArgument[];
  /** The arguments, checked before the prompt is built. */
  readonly args: z.ZodObject;
  /** The prompt is listed only while every one of these is in the inventory. */
  readonly requiredTools: readonly string[];
  readonly embeds: (args: PromptArgs) => readonly PromptEmbed[];
  /** The message's lines; `embedded` holds the addresses that were read. */
  readonly lines: (
    args: PromptArgs,
    embedded: ReadonlySet<string>,
  ) => readonly PromptLine[];
}

const BLANK = 'must not be blank';

/** One whitespace-free token, as a client sends a prompt argument. */
function token(description: string, max = 200) {
  return z
    .string()
    .min(1, { error: BLANK })
    .max(max)
    .regex(/^\S+$/, { error: 'must be one word, without spaces' })
    .describe(description);
}

const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;

/** A name or id in a message, quoted so it reads as one value. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

const editAutomation: McpPromptSpec = {
  name: 'edit_automation',
  title: 'Edit a Tale automation',
  description:
    'Change an automation — or create one — and test it on the mocks before saving; nothing is deployed.',
  arguments: [
    {
      name: 'name',
      description:
        'The automation to work on, e.g. billing/dunning; leave it out to create a new one.',
      required: false,
    },
  ],
  args: z.strictObject({
    name: token('The automation to work on.').optional(),
  }),
  requiredTools: [
    'get_docs',
    'get_automation',
    'validate_automation',
    'run_automation',
    'test_automation',
    'save_automation',
  ],
  embeds: ({ name }) =>
    name === undefined
      ? []
      : [{ uri: automationResourceUri(name), required: false }],
  lines: ({ name }, embedded) => [
    ...(name === undefined
      ? [
          {
            text: 'Create a new Tale automation. Ask me what it should do if I have not said, and pick a name list_automations does not show yet.',
            tools: ['list_automations'],
          },
        ]
      : embedded.has(automationResourceUri(name))
        ? [
            {
              text: `Work on the Tale automation ${quoted(name)}; ask me what to change if I have not said. Its latest version is attached; get_automation reads it again. Remember that version: it is your baseVersion.`,
              tools: ['get_automation'],
            },
          ]
        : [
            {
              text: `There is no saved automation named ${quoted(name)} that I can read. Create it under that name, or check the name with list_automations.`,
              tools: ['list_automations'],
            },
          ]),
    {
      text: 'Read the authoring reference once (get_docs, or tale://docs/authoring) before you write.',
      tools: ['get_docs'],
    },
    {
      text: 'Edit the document, then call validate_automation and fix every error; read the warnings too.',
      tools: ['validate_automation'],
    },
    {
      text: 'Run it with run_automation and a realistic input until the output and the effects are right; it runs on the mocks, and nothing leaves Tale.',
      tools: ['run_automation'],
    },
    {
      text: 'Add or update its tests and run them with test_automation.',
      tools: ['test_automation'],
    },
    {
      text: 'Save with save_automation, passing baseVersion and a one-line message.',
      tools: ['save_automation'],
    },
    {
      text: 'Do not deploy, set a trigger or change anything else until I say so. Tell me the new version number and what changed.',
      tools: [],
    },
  ],
};

const debugFailedRun: McpPromptSpec = {
  name: 'debug_failed_run',
  title: 'Explain a failed run',
  description:
    'Find out why a run failed, propose the smallest fix and reproduce it on the mocks; nothing is saved until you agree.',
  arguments: [
    {
      name: 'runId',
      description:
        'The run that failed — the id list_runs answers or the run page shows.',
      required: true,
    },
  ],
  args: z.strictObject({ runId: token('The run that failed.') }),
  requiredTools: ['get_run', 'get_automation', 'run_automation'],
  embeds: ({ runId = '' }) => [{ uri: runResourceUri(runId), required: true }],
  lines: ({ runId = '' }) => [
    {
      text: `Explain in plain words why the run ${quoted(runId)} failed. Its record is attached; get_run reads it again. Read its status, its error and the trace: the failing node's input and error, and why nodes were skipped.`,
      tools: ['get_run'],
    },
    {
      text: 'Read the version it ran with get_automation.',
      tools: ['get_automation'],
    },
    {
      text: "Propose the smallest fix, and reproduce the failure with run_automation and the run's input, on the mocks.",
      tools: ['run_automation'],
    },
    {
      text: 'Save a fix with save_automation and baseVersion only after I agree.',
      tools: ['save_automation'],
    },
    {
      text: 'If the cause is outside the document — a connector nobody connected, a secret nobody stored, a model the organization does not serve — say which, and where in Tale it is set; list_connectors, list_agent_secrets and list_models show what exists. Never ask me to paste a secret.',
      tools: ['list_connectors', 'list_agent_secrets', 'list_models'],
    },
  ],
};

const addTrigger: McpPromptSpec = {
  name: 'add_trigger',
  title: 'Add a trigger',
  description:
    'Decide what starts an automation — a schedule, a webhook or an event — and set it once you agree.',
  arguments: [
    {
      name: 'name',
      description: 'The automation the trigger starts, e.g. billing/dunning.',
      required: true,
    },
    {
      name: 'kind',
      description:
        'schedule, webhook or event; leave it out to decide together.',
      required: false,
    },
  ],
  args: z.strictObject({
    name: token('The automation the trigger starts.'),
    kind: z
      .enum(TRIGGER_KINDS, {
        error: 'must be "schedule", "webhook" or "event"',
      })
      .optional()
      .describe('The trigger kind.'),
  }),
  requiredTools: ['list_triggers', 'set_trigger', 'get_automation'],
  embeds: ({ name = '' }) => [
    { uri: automationResourceUri(name), required: true },
    { uri: 'tale://docs/triggers', required: true },
  ],
  lines: ({ name = '', kind }) => [
    {
      text: `Decide with me what starts the Tale automation ${quoted(name)}${kind === undefined ? '' : `: a ${kind} trigger`}. The automation and the triggers reference (tale://docs/triggers) are attached.`,
      tools: [],
    },
    {
      text: 'Read its current trigger with list_triggers first; it has at most one, and setting another replaces it.',
      tools: ['list_triggers'],
    },
    ...(kind === undefined || kind === 'schedule'
      ? [
          {
            text: 'For a schedule, build the cron from the times I give and name the time zone.',
            tools: [],
          },
        ]
      : []),
    ...(kind === undefined || kind === 'event'
      ? [
          {
            text: 'For an event, pick one that list_events names.',
            tools: ['list_events'],
          },
        ]
      : []),
    ...(kind === undefined || kind === 'webhook'
      ? [
          {
            text: "For a webhook, tell me that its token is shown once and belongs in the sender's secret store, never in a document or a commit.",
            tools: [],
          },
        ]
      : []),
    {
      text: 'A trigger runs only the deployed version: check deployedVersion with get_automation, and check with validate_automation that its inputs accept what the trigger sends (TRIGGER_INPUT_MISMATCH).',
      tools: ['get_automation', 'validate_automation'],
    },
    {
      text: 'Show me the trigger and ask me before you call set_trigger.',
      tools: ['set_trigger'],
    },
  ],
};

/** Every prompt, in the order `prompts/list` lists them. */
const PROMPTS: readonly McpPromptSpec[] = [
  editAutomation,
  debugFailedRun,
  addTrigger,
];

const INVENTORY: ReadonlySet<string> = new Set(
  MCP_TOOLS.map((tool) => tool.name),
);

/** The prompts an inventory can serve: those whose required tools it holds. */
export function promptsFor(
  inventory: ReadonlySet<string>,
  prompts: readonly McpPromptSpec[] = PROMPTS,
): McpPromptSpec[] {
  return prompts.filter((prompt) =>
    prompt.requiredTools.every((tool) => inventory.has(tool)),
  );
}

/** The prompts this endpoint lists. */
export const MCP_PROMPTS: readonly McpPromptSpec[] = promptsFor(INVENTORY);

/** The prompt of that name, if the endpoint lists one. */
export function findMcpPrompt(name: string): McpPromptSpec | undefined {
  return MCP_PROMPTS.find((prompt) => prompt.name === name);
}

/** A prompt's message: its lines whose tools the inventory holds, one per
 * line. */
export function promptText(
  prompt: McpPromptSpec,
  args: PromptArgs,
  embedded: ReadonlySet<string>,
  inventory: ReadonlySet<string> = INVENTORY,
): string {
  return prompt
    .lines(args, embedded)
    .filter((line) => line.tools.every((tool) => inventory.has(tool)))
    .map((line) => line.text)
    .join('\n');
}

/** A prompt as `prompts/list` lists it. */
export function promptListing(prompt: McpPromptSpec): {
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArgument[];
} {
  return {
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    arguments: [...prompt.arguments],
  };
}
