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
 * A fourth tool, `ask_question`, was proposed and declined (2026-08-14):
 * putting a tool on this wire is a product decision. A chat turn never
 * pauses to ask the person something; an automation run that needs an answer
 * asks through its own `ask_human` tool instead.
 *
 * The schemas are hand-written JSON Schema literals in the same shape every
 * other tool surface uses (`lib/mcp/tools.ts`): `additionalProperties: false`
 * and a description per field, because the schema IS the tool's contract with
 * the model.
 *
 * Layer A: pure data — no `node:*`, no Convex — so the pipeline, the wire
 * shaping, and the tests all read one table.
 */

import { KNOWLEDGE_DEFAULT_MIN_SIMILARITY } from '@tale/shared/schemas/knowledge';

import type { ToolDoc } from './context';

export const CHAT_TOOL_NAMES = [
  'rag_search',
  'rag_fetch',
  'web_fetch',
] as const;

export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

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
/** Dense-leg similarity floor the assistant's search falls back to when the
 * organization's `embedding.json` states no `minSimilarity`: cosine hits
 * under it read as noise and are dropped before fusion. BM25 (keyword)
 * hits are never floored — an exact term match stays a result even when
 * the embedding disagrees. The value lives next to the embedding schema;
 * this is its chat-side name. */
export const RAG_SEARCH_MIN_SIMILARITY = KNOWLEDGE_DEFAULT_MIN_SIMILARITY;
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
        'Narrow a task list to one project — only an id already seen in a ' +
        'result row (e.g. "data"."projectId"), never invented. In a project ' +
        'chat the project is implied: its files and tasks are already the ' +
        "scope, so omit this (its own id is accepted, any other project's " +
        'is refused). In the organization chat, project files are not ' +
        "listed here at all — they are read from the project's own chat.",
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
        'What to load: a document file id, a crawled website page URL, an ' +
        'email ref (a "msg:" value a conversation row carried), or a task ' +
        'ref (a "task:" value a rag_search hit carried), exactly as a ' +
        'rag_search result or the attached-documents list gave it.',
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

/** The model-facing description per tool — the PRIMARY steer for when to
 * call, when not to, and what comes back. This full contract rides the wire
 * `tools[].description` only; the system prompt carries the one-line
 * {@link CHAT_TOOL_DOCS} instead, so the two surfaces never compete. */
const CHAT_TOOL_DESCRIPTIONS: Record<ChatToolName, string> = {
  rag_search:
    "Search or list the organization's own knowledge AND its work: uploaded " +
    'documents, knowledge entries, crawled website pages, products, ' +
    'contacts, websites, tasks and projects, and inbox conversations — the ' +
    'text of the emails they received included. The ' +
    'scope is decided by where the chat lives: a project chat reaches its ' +
    "project's files and tasks plus the organization's shared knowledge " +
    '(other projects are out of scope); the organization chat reaches the ' +
    "shared knowledge and every project's board, but project files only " +
    "from the project's own chat. Two " +
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
    'already contain it. A name, identifier, value, decision or document ' +
    'you do not know is such a need — search before answering that you do ' +
    'not have it; never ask where it would live before looking. "score" ' +
    'orders hits within one response only. ' +
    'Document, web-page and task rows carry a "ref" for rag_fetch; contact, ' +
    'product, knowledge-entry, website and project rows carry their content ' +
    'inline and cannot be fetched. A conversation row that an email matched ' +
    'carries the matching passage as its "snippet" and a "ref" that ' +
    'rag_fetch reads the whole email by; cite the conversation by its title. ' +
    'Other conversation rows carry their details inline. ' +
    'A "snippet" that ends in "…(+N chars)" ' +
    'is cut: when what you need is not in it, rag_fetch the ref at the ' +
    'hit\'s "offset" before answering that the source does not hold it. ' +
    'Never present one page of a list as the ' +
    'whole set: when "hasMore" is true, pass the "continueCursor" back as ' +
    '"cursor", or say which part you saw. Ignore rows that do not answer ' +
    'the question. When a search comes back empty or unhelpful, do not ' +
    're-run reworded variants — switch to action="list" for browse ' +
    'questions, answer from what you have, or use web_fetch when a public ' +
    "page's URL is known.",
  rag_fetch:
    'Load the full detail behind a "ref": a document file id (from a ' +
    'rag_search hit or the attached-documents list), a crawled website page ' +
    'URL, an email ref (from a conversation row an email matched — it ' +
    "returns that email's whole text), a task ref, or a project ref. A task " +
    "ref returns that task's full " +
    'description plus its comments, subtasks and blockers — use it when a ' +
    'question needs more than the title and status a search hit already ' +
    "carried. A project ref returns that project's tasks, which is how you " +
    'answer "the project has 8 open tasks, which ones?". ' +
    'Fetch before quoting or summarizing content, and before concluding ' +
    'that a source does not hold a fact — a search hit is only a snippet, ' +
    'cut where it ends in "…(+N chars)". When an attachment already names its ref, fetch it ' +
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
