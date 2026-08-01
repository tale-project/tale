/**
 * The chat assistant's tool loadout — exactly three read-only tools, fixed.
 *
 * This is a deliberate product boundary (the Chat·Task·Automation model), not
 * a default waiting for configuration: Chat is for questions and retrieval,
 * so its assistant may search the organization's knowledge (`rag_search`),
 * load full content it found (`rag_fetch`), and fetch a public page
 * (`web_fetch`) — and nothing else. Deliverables (a PPT, a translated file, a
 * document) are produced on a Task assigned to an agent, never inline in
 * chat; execution, connectors, and skills live in the task and automation
 * lanes. Adding a fourth tool here is a product decision, not a plumbing one.
 *
 * The schemas are hand-written JSON Schema literals in the same shape every
 * other tool surface uses (`lib/mcp/tools.ts`): `additionalProperties: false`
 * and a description per field, because the schema IS the tool's contract with
 * the model.
 *
 * Layer A: pure data — no `node:*`, no Convex — so the pipeline, the wire
 * shaping, and the tests all read one table.
 */

import type { ToolDoc } from './context';

export const CHAT_TOOL_NAMES = [
  'rag_search',
  'rag_fetch',
  'web_fetch',
] as const;

export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

export function isChatToolName(value: string): value is ChatToolName {
  return (CHAT_TOOL_NAMES as readonly string[]).includes(value);
}

/** One tool call the model requested, as the host decoded it off the wire. */
export interface ToolCallRequest {
  /** The provider's call id — echoed back so the result pairs with the call. */
  readonly id: string;
  readonly name: string;
  /** The parsed arguments. `{}` when the model sent none or sent JSON that
   * did not parse — `rawInput` then carries what it actually sent. */
  readonly input: unknown;
  /** The raw argument string, kept only when it failed to parse, so the
   * executor can answer with a correctable error instead of a guess. */
  readonly rawInput?: string;
}

/** A tool definition as the provider wire wants it. Both dialects consume
 * this one shape; the wire builder spells it per dialect. */
export interface WireTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments object. */
  readonly parameters: Record<string, unknown>;
}

/**
 * The executor port the turn pipeline calls. Injected (like the model call
 * and the store) so the pipeline stays pure and a test drives the loop with a
 * fake. `execute` NEVER throws: every failure is a structured result the
 * model can read and act on — a thrown error would end the whole turn over
 * one bad tool call.
 */
export interface ChatToolExecutor {
  readonly wireTools: readonly WireTool[];
  execute(call: ToolCallRequest): Promise<unknown>;
}

// ------------------------------------------------------------------ schemas

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

/** How many results one `rag_search` may return. */
export const RAG_SEARCH_MAX_LIMIT = 20;
export const RAG_SEARCH_DEFAULT_LIMIT = 8;

const RAG_SEARCH_SCHEMA = object(
  {
    query: {
      type: 'string',
      description: 'What to look for, in the words a person would use.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: RAG_SEARCH_MAX_LIMIT,
      description: `How many results to return (default ${RAG_SEARCH_DEFAULT_LIMIT}).`,
    },
  },
  ['query'],
);

const RAG_FETCH_SCHEMA = object(
  {
    ref: {
      type: 'string',
      description:
        'What to load: a document file id from a rag_search result, or the ' +
        'URL of a crawled website page.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description:
        'Character offset to start reading from: a rag_search hit’s ' +
        '"offset" to land on the match, or the "nextOffset" a truncated ' +
        'result reports to continue.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 20_000,
      description:
        'How many characters to return (default and maximum 20000). With ' +
        '"offset" this selects an exact content range.',
    },
  },
  ['ref'],
);

const WEB_FETCH_SCHEMA = object(
  {
    url: {
      type: 'string',
      description: 'The full public https:// URL of the page to fetch.',
    },
  },
  ['url'],
);

/** The model-facing description per tool — mirrored in the tool docs block of
 * the system prompt, so the prose and the definitions never disagree. */
const CHAT_TOOL_DESCRIPTIONS: Record<ChatToolName, string> = {
  rag_search:
    "Search the organization's knowledge: documents, knowledge entries, " +
    'crawled website pages, products, and contacts. Returns ranked results ' +
    'with a ref you can pass to rag_fetch for the full content; document ' +
    'and page hits also carry the match’s character "offset" — start ' +
    'rag_fetch there to read around the match.',
  rag_fetch:
    'Load the full text of one piece of org content: a document (by the ' +
    'file id a rag_search result carries) or a crawled website page (by its ' +
    'URL). Reads a window of up to 20000 characters; "offset" and "limit" ' +
    'select an exact range, and a truncated result reports the "nextOffset" ' +
    'to continue from.',
  web_fetch:
    'Fetch a public web page by URL and read it as text. Only for pages ' +
    "outside the organization's knowledge — content already crawled into " +
    'Knowledge is served by rag_search / rag_fetch.',
};

/** The provider-wire definitions, in the fixed loadout order. */
export const CHAT_WIRE_TOOLS: readonly WireTool[] = [
  {
    name: 'rag_search',
    description: CHAT_TOOL_DESCRIPTIONS.rag_search,
    parameters: RAG_SEARCH_SCHEMA,
  },
  {
    name: 'rag_fetch',
    description: CHAT_TOOL_DESCRIPTIONS.rag_fetch,
    parameters: RAG_FETCH_SCHEMA,
  },
  {
    name: 'web_fetch',
    description: CHAT_TOOL_DESCRIPTIONS.web_fetch,
    parameters: WEB_FETCH_SCHEMA,
  },
];

/** The one-line-per-tool block for the system prompt (`context.ts`). */
export const CHAT_TOOL_DOCS: readonly ToolDoc[] = CHAT_WIRE_TOOLS.map(
  (tool) => ({ id: tool.name, description: tool.description }),
);
