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

/** How many results one `rag_search` may return. Doubles as the `list`
 * action's default page size: a list is a page the model reads in full, so
 * the default IS the ceiling. */
export const RAG_SEARCH_MAX_LIMIT = 20;
export const RAG_SEARCH_DEFAULT_LIMIT = 8;

/** The two verbs `rag_search` accepts. An explicit verb, because inferring
 * "list" from an empty query is the classic tool-design trap: models omit
 * optional fields, and an omission must never silently become a different
 * operation. One array feeds the schema, the executor, and the tests, so the
 * three cannot drift. */
export const RAG_SEARCH_ACTIONS = ['search', 'list'] as const;
export type RagSearchAction = (typeof RAG_SEARCH_ACTIONS)[number];

/** The ten result kinds `rag_search` returns — and the browse targets the
 * `list` action accepts (all but `web-page`, which has no bounded catalog;
 * the executor refuses it with a steer). Singular, because one list call
 * browses ONE backend — this is not a type-tag array over a shared index. */
export const RAG_SEARCH_KINDS = [
  'document',
  'mail-attachment',
  'web-page',
  'knowledge-entry',
  'product',
  'contact',
  'website',
  'task',
  'project',
  'conversation',
] as const;
export type RagSearchKind = (typeof RAG_SEARCH_KINDS)[number];

/** Task statuses the tool accepts, `open` shorthand included. The executor
 * and the schema both read THIS list — previously the executor kept a
 * hand-written mirror, which nothing tested. */
export const RAG_SEARCH_STATUS_VALUES = [
  'open',
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
] as const;
export type RagSearchStatus = (typeof RAG_SEARCH_STATUS_VALUES)[number];
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
    action: {
      type: 'string',
      enum: [...RAG_SEARCH_ACTIONS],
      description:
        'What to do: "search" retrieves by meaning or leftover keywords; ' +
        '"list" browses one kind with filters and no text match. Always ' +
        'pass it.',
    },
    query: {
      type: 'string',
      description:
        'The information need for action="search": a short question or noun ' +
        'phrase with distinctive terms. Omit for action="list". Do not ' +
        're-search reworded variants of a query that already came back empty.',
    },
    kind: {
      type: 'string',
      enum: [...RAG_SEARCH_KINDS],
      description:
        'Which result kind to browse — required for action="list" (one kind ' +
        'per call). On action="search" it narrows the search to that kind ' +
        'alone; omit it to search everything. kind="web-page" cannot be ' +
        'listed — search it, or list kind="website".',
    },
    status: {
      type: 'string',
      enum: [...RAG_SEARCH_STATUS_VALUES],
      description:
        'Filter TASK results by status. "open" means not done and not ' +
        'cancelled — use it for "open", "outstanding" or "current" work. ' +
        '"in_review" is the "In review" / "In Prüfung" / "En revue" column. ' +
        'Listing tasks requires this or "projectId". Omit it when the ' +
        'question does not name a state. Ignored by every other kind of ' +
        'result.',
    },
    projectId: {
      type: 'string',
      description:
        'Filter tasks or documents to one project. Only an id already seen ' +
        'in a result row (e.g. "data"."projectId") — never invent one; if ' +
        'you only hold a project name, find the project first.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: RAG_SEARCH_MAX_LIMIT,
      description:
        `How many results to return (search default ${RAG_SEARCH_DEFAULT_LIMIT}; ` +
        `list default and maximum ${RAG_SEARCH_MAX_LIMIT}).`,
    },
    cursor: {
      type: 'string',
      description:
        'The "continueCursor" a previous list result reported — continues ' +
        'that same list on its next page. Only for action="list"; ignored ' +
        'on search.',
    },
  },
  ['action'],
);

const RAG_FETCH_SCHEMA = object(
  {
    ref: {
      type: 'string',
      description:
        'What to load: a document file id, a crawled website page URL, or a ' +
        'task ref (a "task:" value a rag_search hit carried), ' +
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
    offset: {
      type: 'integer',
      minimum: 0,
      description:
        'Character offset to start reading from — the "nextOffset" a ' +
        'truncated result reports to continue reading the same page.',
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
    "Search or list the organization's own knowledge AND its work: uploaded " +
    'documents, knowledge entries, crawled website pages, products, ' +
    'contacts, websites, tasks and projects, and inbox conversations. Two ' +
    'actions. action="search" retrieves by meaning or keywords: pass ' +
    '"query" as a short information need — a question or noun phrase with ' +
    'distinctive terms ("refund policy", "login review task") — never the ' +
    'user\'s whole message; put board state in "status", not in the query. ' +
    'action="list" browses ONE kind with filters and no text match — use it ' +
    'when the user asks to see, list, or browse a set of things ("list the ' +
    'tasks in review", "show our contacts"): pass "kind", and for ' +
    'kind="task" also "status" or "projectId" (a whole-workspace task dump ' +
    'is refused). One named item is a search, not a list; a bare state ' +
    'question ("what is open?") is a task list with that "status". This is ' +
    'how you answer questions about the board — what is open, who is ' +
    'working on what, what a project contains; never suggest an external ' +
    'task tracker. It is not for general knowledge, definitions, or ' +
    'reasoning about what the user wrote — call it only when the answer ' +
    "needs the organization's material and the conversation does not " +
    'already contain it. "score" orders hits within one response only. ' +
    'Document, web-page and task rows carry a "ref" for rag_fetch; contact, ' +
    'product, knowledge-entry, website and project rows carry their content ' +
    'inline and cannot be fetched. Never present one page of a list as the ' +
    'whole set: when "hasMore" is true, pass the "continueCursor" back as ' +
    '"cursor", or say which part you saw. Ignore rows that do not answer ' +
    'the question. When a search comes back empty or unhelpful, do not ' +
    're-run reworded variants — switch to action="list" for browse ' +
    'questions, answer from what you have, or use web_fetch when a public ' +
    "page's URL is known.",
  rag_fetch:
    'Load the full detail behind a "ref": a document file id (from a ' +
    'rag_search hit or the attached-documents list), a crawled website page ' +
    "URL, a task ref, or a project ref. A task ref returns that task's full " +
    'description plus its comments, subtasks and blockers — use it when a ' +
    'question needs more than the title and status a search hit already ' +
    "carried. A project ref returns that project's tasks, which is how you " +
    'answer "the project has 8 open tasks, which ones?". ' +
    'Fetch before quoting or summarizing content — a search hit ' +
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
    'served by rag_fetch, not this tool. Reads a window of up to 20000 ' +
    'characters; "offset" and "limit" select an exact range, and a ' +
    'truncated result reports the "nextOffset" to continue from (each ' +
    'call re-fetches the live page). Never present a partial read as the ' +
    'whole page — keep fetching until "nextOffset" is absent, or say ' +
    'exactly which part you read.',
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
      "search or list the organization's knowledge and work (documents, " +
      'entries, pages, products, contacts, tasks, projects)',
  },
  {
    id: 'rag_fetch',
    description:
      'load the full content behind a search hit, attached document, or task',
  },
  { id: 'web_fetch', description: 'fetch a public web page by URL' },
];
