/**
 * The chat assistant's tool loadout — three read-only tools, fixed.
 *
 * This is a deliberate product boundary (the Chat·Task·Automation model), not
 * a default waiting for configuration: Chat is for questions and retrieval,
 * so its assistant may search the organization's knowledge (`rag_search`),
 * load full content it found (`rag_fetch`), and fetch a public page
 * (`web_fetch`) — and nothing else. Deliverables (a PPT, a translated file, a
 * document) are produced on a Task assigned to an agent, never inline in
 * chat; execution, connectors, and skills live in the task and automation
 * lanes.
 *
 * A fourth tool, `ask_question`, was BUILT (its schema, pause gate, executor
 * flow, and answer panel all landed with #2965) but is deliberately NOT in
 * the loadout: putting a tool on this wire is a product decision, and the
 * owner declined this one (2026-08-14). {@link ASK_QUESTION_TOOL} keeps the
 * finished wire definition, {@link PAUSING_CHAT_TOOLS} and the renderers stay
 * live because historical threads already carry its parts — enabling it
 * later is a one-line loadout change, not a rebuild.
 *
 * The schemas are hand-written JSON Schema literals in the same shape every
 * other tool surface uses (`lib/mcp/tools.ts`): `additionalProperties: false`
 * and a description per field, because the schema IS the tool's contract with
 * the model.
 *
 * Layer A: pure data — no `node:*`, no Convex — so the pipeline, the wire
 * shaping, and the tests all read one table.
 */

import {
  MAX_INTRO_LENGTH,
  MAX_OPTIONS_PER_QUESTION,
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_QUESTIONS_PER_SET,
  MAX_QUESTION_HEADER_LENGTH,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS_PER_QUESTION,
} from '../shared/schemas/questions';
import { isRecord } from '../utils/type-utils';
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

/**
 * Tools that END the turn instead of feeding a result back to the model.
 *
 * A retrieval tool answers and the loop continues; a question has no answer
 * yet, so continuing would mean the model inventing what the person was about
 * to say. The turn therefore settles on a valid call, and a later answer
 * starts a NEW turn carrying it.
 *
 * This has to be enforced, not requested. The release notes for v0.2.91
 * record the previous version of this gate being auto-retried straight past
 * into execution — the model asked, nothing stopped it, and it carried on
 * against its own guess.
 */
export const PAUSING_CHAT_TOOLS: ReadonlySet<string> = new Set([
  'ask_question',
]);

export function isPausingChatTool(name: string): boolean {
  return PAUSING_CHAT_TOOLS.has(name);
}

/**
 * What a pausing tool returns once it has registered its question. The
 * pipeline reads this shape to settle the turn and to write the compact
 * transcript row, so it is declared HERE — pure data both the executor and
 * the pipeline import, rather than a shape the two agree on by accident.
 */
export interface AwaitingAnswerResult {
  readonly status: 'awaiting-answer';
  /** The approval row the answer will land on. */
  readonly requestId: string;
  /** The FIRST question asked — the transcript row's label. */
  readonly question: string;
  /** How many questions the set carried. */
  readonly questionCount?: number;
}

export function isAwaitingAnswerResult(
  value: unknown,
): value is AwaitingAnswerResult {
  if (!isRecord(value)) return false;
  return (
    value.status === 'awaiting-answer' &&
    typeof value.requestId === 'string' &&
    typeof value.question === 'string'
  );
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
/** Dense-leg similarity floor: cosine hits under this read as noise and are
 * dropped before fusion. BM25 (keyword) hits are never floored — an exact
 * term match stays a result even when the embedding disagrees. */
export const RAG_SEARCH_MIN_SIMILARITY = 0.45;
/** Per-leg cap for the entity legs (knowledge entries, contacts, products,
 * websites). Each leg is capped on its own — never by a global slice over
 * the concatenated list, which would let document hits starve an exact
 * contact or product match out of the results. */
export const RAG_SEARCH_ENTITY_LIMIT = 5;

const RAG_SEARCH_SCHEMA = object(
  {
    query: {
      type: 'string',
      description:
        "The user's question, in the words they used. Do not re-search " +
        'reworded variants of a query that already came back empty.',
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
        'What to load: a document file id or a crawled website page URL, ' +
        'exactly as a rag_search result or the attached-documents list ' +
        'gave it.',
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

/**
 * The question schema, on the wire. Bounds come from the shared Zod schema
 * rather than being spelled twice, and a test asserts the two agree — the
 * model is told the same limits the boundary will actually enforce, so a
 * rejected call is a model mistake and never a contract mismatch.
 *
 * Note what has NO spelling here: a free-text question. `options` is required
 * and there is no `type` discriminator, so the shape a model would reach for
 * to put a blank box in front of someone cannot be expressed.
 */
const ASK_QUESTION_SCHEMA = object(
  {
    intro: {
      type: 'string',
      maxLength: MAX_INTRO_LENGTH,
      description:
        'One line saying what you are trying to settle. Optional; the ' +
        'questions carry the detail.',
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_QUESTIONS_PER_SET,
      description:
        `The questions to ask, at most ${MAX_QUESTIONS_PER_SET}. Ask only ` +
        'what you genuinely cannot infer — each one costs the person a step.',
      items: object(
        {
          id: {
            type: 'string',
            description:
              'Short stable key for this question (e.g. "purpose"). Unique ' +
              'within the call.',
          },
          question: {
            type: 'string',
            maxLength: MAX_QUESTION_LENGTH,
            description:
              'The question itself, as one self-contained sentence a person ' +
              'can answer without re-reading the conversation.',
          },
          header: {
            type: 'string',
            maxLength: MAX_QUESTION_HEADER_LENGTH,
            description:
              `Optional label of at most ${MAX_QUESTION_HEADER_LENGTH} ` +
              'characters for the progress chip (e.g. "Purpose").',
          },
          options: {
            type: 'array',
            minItems: MIN_OPTIONS_PER_QUESTION,
            maxItems: MAX_OPTIONS_PER_QUESTION,
            description:
              'The answers on offer — REQUIRED. Write the ones a person is ' +
              'most likely to mean, in their words. Never ask for free text: ' +
              'an "Other" choice is added for you, so a question with no ' +
              'options is rejected.',
            items: object(
              {
                label: {
                  type: 'string',
                  maxLength: MAX_OPTION_LABEL_LENGTH,
                  description:
                    'What the option says. Unique within the question, and ' +
                    'short enough to scan.',
                },
                description: {
                  type: 'string',
                  maxLength: MAX_OPTION_DESCRIPTION_LENGTH,
                  description:
                    'What picking this would mean. Optional, but it is what ' +
                    'makes the choice an informed one.',
                },
              },
              ['label'],
            ),
          },
          multiSelect: {
            type: 'boolean',
            description:
              'True when more than one option may apply. Defaults to false.',
          },
        },
        ['id', 'question', 'options'],
      ),
    },
  },
  ['questions'],
);

/** The model-facing description per tool — the PRIMARY steer for when to
 * call, when not to, and what comes back. This full contract rides the wire
 * `tools[].description` only; the system prompt carries the one-line
 * {@link CHAT_TOOL_DOCS} instead, so the two surfaces never compete. */
const CHAT_TOOL_DESCRIPTIONS: Record<ChatToolName, string> = {
  rag_search:
    "Search the organization's own knowledge: uploaded documents, knowledge " +
    'entries, crawled website pages, products, and contacts. Call it when ' +
    "the answer needs the organization's material and the conversation does " +
    'not already contain it — not for general knowledge, definitions, or ' +
    'reasoning about what the user wrote. Results come back ranked; "score" ' +
    'orders hits within one response only. Only document and web-page rows ' +
    'carry a "ref" for rag_fetch (plus the match\'s character "offset"); ' +
    'contact, product, knowledge-entry, and website rows carry their ' +
    'content inline and cannot be fetched. Ignore rows that do not answer ' +
    'the question. When a search comes back empty or unhelpful, do not ' +
    're-run reworded variants — answer from what you have, or use web_fetch ' +
    "when a public page's URL is known.",
  rag_fetch:
    'Load the full text behind a "ref": a document file id (from a ' +
    'rag_search hit or the attached-documents list) or a crawled website ' +
    'page URL. Fetch before quoting or summarizing content — a search hit ' +
    'is only a snippet. When an attachment already names its ref, fetch it ' +
    'directly; do not rag_search the organization for a file whose ref you ' +
    'already hold. Reads a window of up to 20000 characters; "offset" and ' +
    '"limit" select an exact range, and a truncated result reports the ' +
    '"nextOffset" to continue from. Never present a partial read as a ' +
    'summary of the whole source — keep fetching until "nextOffset" is ' +
    'absent, or say exactly which part you read (compare "totalChars" to ' +
    'what you have seen).',
  web_fetch:
    'Fetch a live public https:// page and read it as text. Use it when ' +
    'you hold a concrete URL — one the user gave, one a search row ' +
    "carried, or a well-known public page — and the organization's " +
    'knowledge did not answer. Content already in the knowledge base is ' +
    'served by rag_fetch, not this tool.',
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

/**
 * The built-but-disabled ask tool, kept OFF {@link CHAT_WIRE_TOOLS} on
 * purpose (see the module doc): the owner declined a fourth chat tool. The
 * definition stays complete — schema-bound to the shared question contract
 * and covered by the schema-agreement tests — so enabling it is exactly one
 * entry in the loadout, and nothing else drifts in the meantime.
 */
export const ASK_QUESTION_TOOL: WireTool = {
  name: 'ask_question',
  description:
    'Ask the person one to four multiple-choice questions when the request ' +
    'is genuinely ambiguous and guessing would waste their time. THIS ENDS ' +
    'YOUR TURN: you get no result back, and you are called again with their ' +
    'answers, so ask everything you need in ONE call and say nothing after ' +
    'it. Every question must offer 2-4 options you write yourself — an ' +
    '"Other" choice is added automatically, so never ask for free text and ' +
    'never list choices as plain text in your reply. Do not use this for ' +
    'anything you can infer, look up with rag_search, or reasonably assume; ' +
    'a wrong assumption the person can correct beats a question they did ' +
    'not need.',
  parameters: ASK_QUESTION_SCHEMA,
};

/** The one-line-per-tool block for the system prompt (`context.ts`) —
 * deliberately NOT the wire descriptions. The full contract travels on the
 * tool definitions the provider already receives; pasting it here as well
 * would put two copies in front of the model to fight over priority. */
export const CHAT_TOOL_DOCS: readonly ToolDoc[] = [
  {
    id: 'rag_search',
    description:
      "search the organization's knowledge (documents, entries, crawled " +
      'pages, products, contacts)',
  },
  {
    id: 'rag_fetch',
    description:
      'load the full content behind a search hit or attached document',
  },
  { id: 'web_fetch', description: 'fetch a public web page by URL' },
];
