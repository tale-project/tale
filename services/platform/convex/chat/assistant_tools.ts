'use node';

/**
 * The chat assistant's three tools, executed — the Convex side of
 * `lib/chat/tools.ts`.
 *
 * One factory builds the {@link ChatToolExecutor} a direct chat turn injects
 * into the pipeline. Everything here is READ-ONLY and follows the workspace
 * bridge's discipline (`node_only/sandbox/workspace_tools_bridge.ts`):
 * whatever a tool returns is relayed to the model as the tool result, so
 * every shape is written FOR THE MODEL — structured status + guidance, never
 * a bare throw — and a failure ends the tool call, never the turn. Every
 * dispatch re-resolves the turn user's access the way a user-side read would
 * (`resolveWorkspaceReadAccess`), is audit-logged, and lands in the usage
 * ledger's connector lane.
 *
 * Honesty rules the empty cases: the RAG corpora may simply not be populated
 * (ingest is offline while the knowledge rebuild lands), an organization may
 * have no embedding model configured, and a role may deny a subject — each
 * of those reads differently in the result, so the model can tell the user
 * what is actually going on instead of hallucinating around a silent [].
 *
 * `'use node'` because knowledge search binds an embedder and `web_fetch`
 * does real network I/O.
 */

import {
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_KINDS,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_MIN_SIMILARITY,
  RAG_SEARCH_STATUS_VALUES,
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  CHAT_ASSISTANT_SLUG,
  type ChatToolExecutor,
  type RagSearchKind,
  type ToolCallRequest,
} from '../../lib/chat';
import { htmlTitle, htmlToText } from '../../lib/knowledge/html-to-text';
import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../lib/knowledge/types';
import { modelTimestamp } from '../../lib/shared/model-timestamp';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  FETCH_WINDOW_CHARS,
  fetchDocumentByFileId,
  fetchWebPageByUrl,
  windowText,
} from '../knowledge/fetch';
import { searchKnowledge } from '../knowledge/search';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { SafeFetchError, isPrivateIp, safeFetch } from '../lib/http/safe_fetch';
import type { AgentReadSubject } from '../lib/rls/helpers/agent_read_access';
import { detectListingIntent } from '../lib/search';
import { toId } from '../lib/type_cast_helpers';
import { wrapUntrusted } from '../lib/untrusted_content';

/** Who the tools run for. The user is re-checked per dispatch. */
export interface ChatToolContext {
  readonly organizationId: string;
  readonly userId: string;
  /**
   * The turn's thread LINEAGE — the branch root plus every sibling (see
   * `chat/branches.getThreadLineageIds`), already ownership-checked by the
   * send boundary. Unlocks retrieval of this conversation's chat-uploaded
   * documents (they are thread-private, invisible to every other knowledge
   * surface); the whole lineage is needed because uploads bind against the
   * visible thread while a regenerate runs on a hidden sibling. Absent (a
   * test's bare executor) reads as "no thread uploads retrievable".
   */
  readonly threadIds?: readonly string[];
}

/** A page bigger than this is cut BEFORE extraction — a tool result must
 * never threaten the Convex value ceiling. */
const WEB_FETCH_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const WEB_FETCH_TIMEOUT_MS = 15_000;
/** Snippet budget per rag_search result. */
const SNIPPET_CHARS = 500;

/**
 * Namespace prefixes that make a work row's `ref` self-describing, so
 * `rag_fetch` can route one without a lookup.
 *
 * Safe against the two ref shapes that already exist: a document ref is a
 * storage id or an `s3:` blob ref, and a page ref is an `http(s)://` URL —
 * neither can begin with `task:` or `project:`. Keep them distinct from the
 * `s3:` scheme for the same reason.
 */
const WORK_REF_PREFIX = { task: 'task:', project: 'project:' } as const;

/**
 * What a listing leg reports as its source.
 *
 * A listing walks a bounded number of rows and filters as it goes, so a caller
 * who can read little may exhaust that budget before the index ends. Saying
 * "these are the tasks in scope" would then overclaim: the rows returned are
 * the most recently updated ones the walk reached, not the whole board. Mirrors
 * how the conversations leg names its own bound.
 */
function listedSource(subject: string, complete: boolean): string {
  return complete
    ? `listed (nothing matched those words, so these are the ${subject} in scope)`
    : `listed (nothing matched those words; these are the most recently updated ${subject} in scope, not the whole set)`;
}

/** Tasks returned when a project ref is fetched. Enough to answer "what is on
 *  this project?", small enough that a model reads the whole list. */
const PROJECT_TASKS_LIMIT = 25;

/**
 * The two archive facts a result can carry, as data.
 *
 * `archived` means the result itself is archived. `projectArchived` means the
 * project it belongs to is archived, which is a different fact: a live task in
 * a retired project may still be real work nobody closed, while an archived
 * task is not. Both can be true at once, and each key is omitted when false so
 * a live result in a live project carries neither.
 *
 * Nothing here decides what the assistant says about them. They sit beside
 * `status` and `priority` as fields it may use, which is why a document under a
 * retired project can be cited with that context instead of being withheld.
 */
function archiveFlags(args: {
  archivedAt?: number | undefined;
  projectId?: string | null | undefined;
  archivedProjectIds: ReadonlySet<string>;
}): { archived?: true; projectArchived?: true } {
  return {
    ...(args.archivedAt !== undefined ? { archived: true as const } : {}),
    ...(args.projectId != null && args.archivedProjectIds.has(args.projectId)
      ? { projectArchived: true as const }
      : {}),
  };
}

// ------------------------------------------------------------- result rows

/** One `rag_search` result row — the SAME shape for a search hit and a
 * listed row, so the model never learns two vocabularies. */
interface SearchResultEntry {
  readonly kind: RagSearchKind;
  readonly title: string;
  /** What `rag_fetch` accepts: a document file id, a page URL, or a work
   * ref. Entity rows carry their content inline instead. */
  readonly ref?: string;
  readonly url?: string;
  readonly snippet?: string;
  /** Char position of the match within the ref's full text — a rag_fetch
   * starting offset that lands on the match instead of the start. */
  readonly offset?: number;
  /** Retrieval ranking (reranker score when one ran, else the fusion
   * score). Orders hits within ONE response only — the fusion score is a
   * reciprocal-rank value, not a similarity, so its absolute magnitude
   * means nothing across searches. Absent on listed rows: a listing is
   * ordered by recency, not relevance. */
  readonly score?: number;
  readonly data?: Record<string, unknown>;
}

// The search legs and the list action build their rows through ONE mapper
// per kind, so the two surfaces can never disagree about what a row says.

function taskResultEntry(
  task: Doc<'tasks'>,
  archivedProjectIds: ReadonlySet<string>,
): SearchResultEntry {
  return {
    kind: 'task',
    title: task.title,
    // A fetchable ref, unlike contacts/products — the depth path for work
    // is `rag_fetch`, not a tool of its own.
    ref: `${WORK_REF_PREFIX.task}${String(task._id)}`,
    ...(task.description
      ? { snippet: clip(task.description, SNIPPET_CHARS) }
      : {}),
    data: {
      status: task.status,
      ...(task.priority ? { priority: task.priority } : {}),
      ...(task.assigneeType ? { assigneeType: task.assigneeType } : {}),
      ...(task.projectId ? { projectId: String(task.projectId) } : {}),
      ...(modelTimestamp(task.dueDate) !== undefined
        ? { dueDate: modelTimestamp(task.dueDate) }
        : {}),
      ...archiveFlags({
        archivedAt: task.archivedAt,
        projectId: task.projectId != null ? String(task.projectId) : null,
        archivedProjectIds,
      }),
    },
  };
}

function projectResultEntry(
  project: Doc<'projects'>,
  archivedProjectIds: ReadonlySet<string>,
): SearchResultEntry {
  return {
    kind: 'project',
    title: project.name,
    ref: `${WORK_REF_PREFIX.project}${String(project._id)}`,
    ...(project.description
      ? { snippet: clip(project.description, SNIPPET_CHARS) }
      : {}),
    data: {
      ...(project.key ? { key: project.key } : {}),
      // The denormalized rollups (`projects/schema.ts`) — a project has
      // no status of its own, and "how much is still open" is what a
      // question about a project usually means. Undefined reads as 0.
      openTasks: project.openTaskCount ?? 0,
      doneTasks: project.doneTaskCount ?? 0,
      // `projectArchived` would be redundant here: this row is the
      // project, so its own `archived` says it.
      ...archiveFlags({
        archivedAt: project.archivedAt,
        archivedProjectIds,
      }),
    },
  };
}

function contactResultEntry(contact: {
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  lifecycleStatus?: string;
}): SearchResultEntry {
  return {
    kind: 'contact',
    title: contact.name ?? 'Unnamed contact',
    data: {
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
      ...(contact.tags && contact.tags.length > 0
        ? { tags: contact.tags }
        : {}),
      // A non-active row must say so, or a trashed contact reads as the
      // current address book.
      ...(contact.lifecycleStatus && contact.lifecycleStatus !== 'active'
        ? { lifecycleStatus: contact.lifecycleStatus }
        : {}),
    },
  };
}

function productResultEntry(product: {
  name?: string;
  category?: string;
  price?: number;
  stock?: number;
  status?: string;
}): SearchResultEntry {
  return {
    kind: 'product',
    title: product.name ?? 'Unnamed product',
    data: {
      ...(product.category ? { category: product.category } : {}),
      ...(product.price !== undefined ? { price: product.price } : {}),
      ...(product.stock !== undefined ? { stock: product.stock } : {}),
      // Draft and archived SKUs are real rows but not current inventory.
      ...(product.status && product.status !== 'active'
        ? { status: product.status }
        : {}),
    },
  };
}

function knowledgeEntryResultEntry(entry: {
  topic: string;
  content: string;
}): SearchResultEntry {
  return {
    kind: 'knowledge-entry',
    title: entry.topic,
    snippet: clip(entry.content, SNIPPET_CHARS * 2),
  };
}

function websiteResultEntry(site: {
  domain: string;
  title?: string;
  description?: string;
}): SearchResultEntry {
  return {
    kind: 'website',
    title: site.title ?? site.domain,
    url: `https://${site.domain}`,
    ...(site.description
      ? { snippet: clip(site.description, SNIPPET_CHARS) }
      : {}),
  };
}

function conversationResultEntry(conversation: {
  subject?: string;
  status?: string;
  channel?: string;
  lastMessageAt?: number;
  assigneeUserId?: string;
  assigneeTeamId?: string;
}): SearchResultEntry {
  return {
    kind: 'conversation',
    title: conversation.subject ?? 'Conversation',
    data: {
      ...(conversation.status ? { status: conversation.status } : {}),
      ...(conversation.channel ? { channel: conversation.channel } : {}),
      ...(conversation.assigneeUserId
        ? { assigneeUserId: conversation.assigneeUserId }
        : {}),
      ...(conversation.assigneeTeamId
        ? { assigneeTeamId: conversation.assigneeTeamId }
        : {}),
      ...(conversation.assigneeUserId || conversation.assigneeTeamId
        ? {}
        : // Unassigned is a real state an admin acts on, not missing data.
          { unassigned: true }),
      ...(modelTimestamp(conversation.lastMessageAt) !== undefined
        ? { lastMessageAt: modelTimestamp(conversation.lastMessageAt) }
        : {}),
    },
  };
}

/** Task statuses `rag_search` accepts, plus the `open` shorthand — the SAME
 * array the schema enum is built from (`lib/chat/tools.ts`), so the two
 * cannot drift. On a search an unknown value is dropped rather than refused,
 * so a model guessing never fails the whole fan-out; an explicit LISTING of
 * one status is different — there a typo silently listing everything would
 * be wrong, so the list path refuses it instead. */
type WorkStatusFilter = (typeof RAG_SEARCH_STATUS_VALUES)[number];

/** A type PREDICATE rather than a cast: narrowing an unknown tool argument by
 * assertion is exactly what `no-unsafe-type-assertion` exists to stop. */
function isWorkStatus(value: unknown): value is WorkStatusFilter {
  return (
    typeof value === 'string' &&
    (RAG_SEARCH_STATUS_VALUES as readonly string[]).includes(value)
  );
}

/** Same shape for the result-kind argument. */
function isRagSearchKind(value: unknown): value is RagSearchKind {
  return (
    typeof value === 'string' &&
    (RAG_SEARCH_KINDS as readonly string[]).includes(value)
  );
}

/** Copyable next-call examples for `invalid_args` messages. A correction the
 * model can paste beats prose describing one — the message IS the retry. */
const EXAMPLE_SEARCH_CALL = '{"action":"search","query":"refund policy"}';
const EXAMPLE_LIST_CALL = '{"action":"list","kind":"task","status":"open"}';

/** The kinds `action: 'list'` accepts — every result kind except `web-page`,
 * which has no bounded org-wide catalog (pages live under their domain; the
 * site inventory is `kind: 'website'`). */
const LISTABLE_KINDS = RAG_SEARCH_KINDS.filter((kind) => kind !== 'web-page');

/** The `sources` key a one-kind list reports under — the same vocabulary the
 * search legs use, so a list result reads like a one-leg search result. */
const LIST_SOURCE_KEYS: Record<RagSearchKind, string> = {
  document: 'documents',
  'mail-attachment': 'mailAttachments',
  'web-page': 'webPages',
  'knowledge-entry': 'knowledgeEntries',
  contact: 'contacts',
  product: 'products',
  website: 'websites',
  task: 'tasks',
  project: 'projects',
  conversation: 'conversations',
};

/** The role-matrix subject each kind's listing answers to — identical to the
 * subject its search leg checks, because a list is not an ACL widening. */
const LIST_READ_SUBJECTS: Record<RagSearchKind, AgentReadSubject> = {
  document: 'documents',
  // Conversations, not documents: an emailed attachment is visible exactly when
  // its conversation is, so the role that gates the inbox gates its files.
  'mail-attachment': 'conversations',
  'web-page': 'websites',
  'knowledge-entry': 'documents',
  contact: 'contacts',
  product: 'products',
  website: 'websites',
  task: 'tasks',
  project: 'projects',
  conversation: 'conversations',
};

const LIST_PAGE_MESSAGE =
  'This is one page, not the whole set. Pass "continueCursor" back as ' +
  '"cursor" for the next page, or say you only saw this page.';

/**
 * What the model is told when the corpora cannot be searched.
 *
 * Deliberately STABLE and free of internals: the model relays this to a person,
 * so a raw `Error.message` here becomes internal configuration prose quoted to
 * an end user who reads it as a product fault. The real cause goes to the log
 * instead, where the person who can fix it will look. Names the remedy in the
 * words the UI uses, so an admin who is told this can act on it.
 */
const KNOWLEDGE_UNAVAILABLE_FOR_MODEL =
  'unavailable: document and web-page search is not set up for this ' +
  'organization yet. An administrator configures it under Settings → Data ' +
  'residency (the embedding model). Say this plainly if it matters to the ' +
  'answer; do not guess at the cause.';

// ------------------------------------------------------------ result shapes

/** Every tool answers with one of these statuses, so the model always knows
 * whether to present, retry with different arguments, or tell the user. */
type ToolStatus = 'ok' | 'not_found' | 'invalid_args' | 'unavailable' | 'error';

interface ToolFailure {
  readonly status: Exclude<ToolStatus, 'ok'>;
  readonly message: string;
}

function invalidArgs(message: string): ToolFailure {
  return { status: 'invalid_args', message };
}

function clip(text: string, budget: number): string {
  return text.length > budget
    ? `${text.slice(0, budget)}…(+${text.length - budget} chars)`
    : text;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plain-object check as a TYPE GUARD, so tool arguments narrow without an
 * unsafe assertion. */
function isArgsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ----------------------------------------------------------------- executor

/**
 * Build the executor for one turn. Access, audit, and metering happen per
 * dispatch; the org slug resolves once on first use.
 */
export function createChatToolExecutor(
  ctx: ActionCtx,
  who: ChatToolContext,
): ChatToolExecutor {
  let orgSlugPromise: Promise<string> | null = null;
  const orgSlug = (): Promise<string> => {
    orgSlugPromise ??= orgSlugFromId(ctx, who.organizationId);
    return orgSlugPromise;
  };

  /** The turn user's document visibility (their teams + accessible projects
   * + the org hub) — the same rules the library listings enforce, so a chat
   * search can never surface a document the Documents page would hide.
   * Resolved once per turn: membership is already re-checked per dispatch by
   * `readAllowed`, and a mid-turn team change taking one turn to bite is the
   * same window every listing query has. */
  let accessPromise: Promise<KnowledgeAccessScope> | null = null;
  const knowledgeAccess = (): Promise<KnowledgeAccessScope> => {
    accessPromise ??= ctx
      .runQuery(internal.documents.internal_queries.resolveKnowledgeAccess, {
        organizationId: who.organizationId,
        userId: who.userId,
      })
      // The turn's own lineage widens the scope to ITS chat uploads — and
      // only its own; the ids were ownership-checked at the send boundary.
      .then((base) =>
        who.threadIds !== undefined && who.threadIds.length > 0
          ? { ...base, threadIds: [...who.threadIds] }
          : base,
      );
    return accessPromise;
  };

  /** Role-matrix read check for one subject; a denial is a result, not a
   * throw, so one denied leg never hides the others. Typed off the shared
   * {@link AgentReadSubject} rather than a second copy of the literal list,
   * so a subject added to the matrix cannot go missing here. */
  const readAllowed = async (subject: AgentReadSubject): Promise<boolean> => {
    const access = await ctx.runQuery(
      internal.sandbox.workspace_access.resolveWorkspaceReadAccess,
      { organizationId: who.organizationId, userId: who.userId, subject },
    );
    return access.allowed;
  };

  /** Best-effort observability: the audit row and the ledger row must never
   * fail a tool call the model already made. */
  const recordDispatch = async (
    tool: string,
    status: ToolStatus,
    detail?: string,
  ): Promise<void> => {
    try {
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
          organizationId: who.organizationId,
          actorId: who.userId,
          actorType: 'user',
          action: `chat.tool.${tool}`,
          category: 'ai',
          resourceType: 'chat_tool',
          resourceId: tool,
          status: status === 'ok' ? 'success' : 'failure',
          ...(detail !== undefined ? { errorMessage: clip(detail, 300) } : {}),
        },
      );
      await ctx.runMutation(
        internal.governance.internal_mutations.recordConnectorUsage,
        {
          organizationId: who.organizationId,
          userId: who.userId,
          agentSlug: CHAT_ASSISTANT_SLUG,
          connectorName: 'chat-tools',
          connectorOperation: tool,
          costEstimateCents: 0,
          timestamp: Date.now(),
        },
      );
    } catch (error) {
      console.warn(
        `[chat] tool dispatch bookkeeping failed for ${tool}: ${describeError(error)}`,
      );
    }
  };

  const execute = async (call: ToolCallRequest): Promise<unknown> => {
    if (call.rawInput !== undefined) {
      return invalidArgs(
        `The arguments were not valid JSON (got: ${clip(call.rawInput, 200)}). Send a well-formed JSON object.`,
      );
    }
    const args = isArgsRecord(call.input) ? call.input : {};
    // The never-throws contract, enforced here for the paths the handlers do
    // not guard themselves (an org-slug read, an entity query, a corpus error
    // that is not "corpus missing"): one failed tool call must cost the model
    // one correctable result, never the whole turn.
    try {
      switch (call.name) {
        case 'rag_search':
          return await ragSearch(args);
        case 'rag_fetch':
          return await ragFetch(args);
        case 'web_fetch':
          return await webFetch(args);
        // `ask_question` deliberately has NO case: the tool is off the wire
        // (lib/chat/tools.ts) and a hallucinated call must not activate the
        // disabled flow — it falls through to the unknown-tool refusal.
        default:
          return invalidArgs(
            `Unknown tool "${call.name}". Available: ${CHAT_TOOL_NAMES.join(', ')}.`,
          );
      }
    } catch (error) {
      console.warn(
        `[chat] tool ${call.name} failed unexpectedly: ${describeError(error)}`,
      );
      return {
        status: 'error',
        message: `The tool failed: ${clip(describeError(error), 200)}. Tell the user; retrying the same call is unlikely to help.`,
      } satisfies ToolFailure;
    }
  };

  // ------------------------------------------------------------- rag_search

  /** One rag_search call per shape per turn. The tools are read-only, so an
   * exact repeat can only re-buy the same rows; the second call gets a steer
   * instead. Keyed on the RESOLVED call — cursor included, so paging is
   * never mistaken for repetition — and only OK results register, so a
   * rejected call keeps earning its corrective message. */
  const seenRagSearchCalls = new Set<string>();

  interface RagSearchOk extends Record<string, unknown> {
    status: 'ok';
  }
  type RagSearchOutcome = RagSearchOk | ToolFailure;

  const ragSearch = async (args: Record<string, unknown>): Promise<unknown> => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const kindRaw = args.kind;
    const statusRaw = args.status;
    const projectId =
      typeof args.projectId === 'string' && args.projectId.trim() !== ''
        ? args.projectId.trim()
        : undefined;
    const cursorRaw =
      typeof args.cursor === 'string' && args.cursor.trim() !== ''
        ? args.cursor.trim()
        : undefined;

    // The verb. The schema requires it, but an omission must not tax the
    // model with a correction round when the meaning is unambiguous: a query
    // has always meant a search, and a kind with no query can only mean a
    // list. What is NEVER inferred is a list from an empty query — that
    // omission-becomes-another-operation trap is why the verb exists.
    let action: 'search' | 'list';
    if (args.action === 'search' || args.action === 'list') {
      action = args.action;
    } else if (args.action === undefined && query !== '') {
      action = 'search';
    } else if (args.action === undefined && isRagSearchKind(kindRaw)) {
      action = 'list';
    } else {
      const result = invalidArgs(
        'rag_search needs "action": "search" (with a "query") or "list" ' +
          `(with a "kind"). Examples: ${EXAMPLE_SEARCH_CALL} · ` +
          `${EXAMPLE_LIST_CALL}. Retry once.`,
      );
      await recordDispatch('rag_search', result.status, result.message);
      return result;
    }

    const callKey = JSON.stringify({
      action,
      kind: isRagSearchKind(kindRaw) ? kindRaw : null,
      status: typeof statusRaw === 'string' ? statusRaw : null,
      projectId: projectId ?? null,
      cursor: cursorRaw ?? null,
      query: query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .sort(),
    });
    if (seenRagSearchCalls.has(callKey)) {
      const result = invalidArgs(
        'This exact rag_search call already ran this turn — use that ' +
          'result instead of repeating it.',
      );
      await recordDispatch('rag_search', result.status, result.message);
      return result;
    }

    const result =
      action === 'list'
        ? await ragSearchList({
            kindRaw,
            query,
            statusRaw,
            projectId,
            cursorRaw,
            limitRaw: args.limit,
          })
        : await ragSearchSearch({
            query,
            kindRaw,
            statusRaw,
            limitRaw: args.limit,
          });
    if (result.status === 'ok') {
      seenRagSearchCalls.add(callKey);
      await recordDispatch('rag_search', 'ok');
    } else {
      await recordDispatch('rag_search', result.status, result.message);
    }
    return result;
  };

  // ---------------------------------------------------- rag_search · search

  const ragSearchSearch = async (call: {
    query: string;
    kindRaw: unknown;
    statusRaw: unknown;
    limitRaw: unknown;
  }): Promise<RagSearchOutcome> => {
    const { query } = call;
    if (query === '') {
      const hint = isWorkStatus(call.statusRaw)
        ? 'To browse the board, call ' +
          `{"action":"list","kind":"task","status":"${call.statusRaw}"}.`
        : 'Pass "query" with distinctive keywords — or browse a kind with ' +
          `${EXAMPLE_LIST_CALL}.`;
      return invalidArgs(
        `action "search" needs a non-empty "query". ${hint} Retry once.`,
      );
    }
    // A query that is PURE listing language matches nothing by construction
    // — steer it to the verb it meant instead of running legs that can only
    // fail. Any surviving noun honors the search (see `listing_intent.ts`).
    const stuffed = detectListingIntent(query);
    if (stuffed !== undefined) {
      const corrected = JSON.stringify({
        action: 'list',
        kind: stuffed.kind,
        ...(stuffed.status !== undefined ? { status: stuffed.status } : {}),
      });
      return invalidArgs(
        'query_looks_like_list: that query only names a kind and a state. ' +
          `Browse it instead: ${corrected}. Retry once.`,
      );
    }

    const limit =
      typeof call.limitRaw === 'number' && call.limitRaw > 0
        ? Math.min(Math.floor(call.limitRaw), RAG_SEARCH_MAX_LIMIT)
        : RAG_SEARCH_DEFAULT_LIMIT;
    // Only the tasks leg reads this; an unknown value is dropped rather than
    // refused, so a model guessing a status never fails the whole search.
    const statusFilter = isWorkStatus(call.statusRaw)
      ? call.statusRaw
      : undefined;
    // An optional narrow: a known kind runs that leg alone (documents and
    // pages are one corpus leg, split by `corpus`). An unknown kind is
    // dropped like an unknown status — the full fan-out still answers.
    const kindFilter = isRagSearchKind(call.kindRaw) ? call.kindRaw : undefined;
    const runLeg = (...kinds: RagSearchKind[]): boolean =>
      kindFilter === undefined || kinds.includes(kindFilter);

    const slug = await orgSlug();
    /** Per-source outcome, so an empty answer is attributable. Narrowed
     * searches report only the legs they ran. */
    const sources: Record<string, string> = {};
    const results: SearchResultEntry[] = [];

    const [
      documentsAllowed,
      contactsAllowed,
      productsAllowed,
      websitesAllowed,
      tasksAllowed,
      projectsAllowed,
      conversationsAllowed,
    ] = await Promise.all([
      readAllowed('documents'),
      readAllowed('contacts'),
      readAllowed('products'),
      readAllowed('websites'),
      readAllowed('tasks'),
      readAllowed('projects'),
      readAllowed('conversations'),
    ]);

    // Leg 1 — the RAG corpora (documents + crawled pages), vector+keyword.
    // Scoped to the turn user's own visibility: team libraries they belong
    // to, projects they can read, and the org hub — never the whole org.
    // The similarity floor drops weak dense neighbours BEFORE they reach the
    // model; keyword (BM25) hits are never floored.
    if (runLeg('document', 'web-page')) {
      // One corpus leg serves both kinds; a narrow selects within it.
      const corpus =
        kindFilter === 'document'
          ? ('documents' as const)
          : kindFilter === 'web-page'
            ? ('web' as const)
            : ('all' as const);
      if (documentsAllowed) {
        try {
          const docAccess = await knowledgeAccess();
          const archivedForDocs = new Set(docAccess.archivedProjectIds ?? []);
          const knowledge = await searchKnowledge(ctx, {
            organizationId: who.organizationId,
            orgSlug: slug,
            query,
            corpus,
            limit,
            minSimilarity: RAG_SEARCH_MIN_SIMILARITY,
            access: docAccess,
          });
          for (const hit of knowledge.hits) {
            const score = hit.rerankScore ?? hit.fusedScore;
            // A document has no archive state of its own — only its project
            // does, so `projectArchived` is the only flag it can carry. It is
            // still returned and still citable; the label is the context.
            const flags = archiveFlags({
              projectId: hit.source.projectId,
              archivedProjectIds: archivedForDocs,
            });
            results.push({
              kind: hit.corpus === 'documents' ? 'document' : 'web-page',
              title: hit.source.title ?? hit.source.ref,
              ref: hit.source.ref,
              ...(hit.source.url ? { url: hit.source.url } : {}),
              snippet: clip(hit.text, SNIPPET_CHARS),
              ...(hit.offset !== undefined ? { offset: hit.offset } : {}),
              score: Math.round(score * 1000) / 1000,
              ...(flags.projectArchived ? { data: flags } : {}),
            });
          }
          if (runLeg('document')) {
            sources.documents = knowledge.hits.some(
              (h) => h.corpus === 'documents',
            )
              ? 'searched'
              : 'searched (no matches — the document index may also still be empty)';
          }
          if (runLeg('web-page')) {
            sources.webPages = knowledge.hits.some((h) => h.corpus === 'web')
              ? 'searched'
              : 'searched (no matches — no crawled pages may be indexed yet)';
          }
        } catch (error) {
          // Two audiences, two messages — conflating them is what made this
          // outage invisible for hours.
          //
          // The OPERATOR needs the real error and needs it in the logs. Before
          // this, "said out loud" meant only to the model, so nothing reached
          // anyone who could fix it: no log line, no badge, no alert, while the
          // tool still returned `status: 'ok'` because the other legs are plain
          // Convex reads that succeed.
          console.warn(
            `[chat] knowledge search unavailable for organization ${who.organizationId}: ${describeError(error)}`,
          );
          // The MODEL gets a stable sentence that names the remedy and leaks no
          // internals. Relaying `Error.message` verbatim is how configuration
          // prose ended up quoted to an end user, who read it as a product
          // fault.
          if (runLeg('document')) {
            sources.documents = KNOWLEDGE_UNAVAILABLE_FOR_MODEL;
          }
          if (runLeg('web-page')) {
            sources.webPages = KNOWLEDGE_UNAVAILABLE_FOR_MODEL;
          }
        }
      } else {
        if (runLeg('document')) {
          sources.documents = 'access denied for your role';
        }
        if (runLeg('web-page')) {
          sources.webPages = 'access denied for your role';
        }
      }
    }

    // Legs 2–5 are capped EACH — never by a global slice over the
    // concatenated list, which would let document hits starve an exact
    // contact or product match out of the results entirely.

    // Leg 2 — knowledge entries (Convex rows; lexical topic match).
    if (runLeg('knowledge-entry')) {
      if (documentsAllowed) {
        const entries = await ctx.runQuery(
          internal.knowledge_entries.internal_queries.listEntriesForAgent,
          {
            organizationId: who.organizationId,
            topic: query,
            paginationOpts: {
              numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
              cursor: null,
            },
          },
        );
        for (const entry of entries.page) {
          results.push(knowledgeEntryResultEntry(entry));
        }
        sources.knowledgeEntries =
          entries.page.length > 0 ? 'searched' : 'searched (no matches)';
      } else {
        sources.knowledgeEntries = 'access denied for your role';
      }
    }

    // Leg 3 — contacts (lexical).
    if (runLeg('contact')) {
      if (contactsAllowed) {
        const contacts = await ctx.runQuery(
          internal.contacts.internal_queries.queryContacts,
          {
            organizationId: who.organizationId,
            searchTerm: query,
            paginationOpts: {
              numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
              cursor: null,
            },
          },
        );
        for (const contact of contacts.page) {
          results.push(contactResultEntry(contact));
        }
        sources.contacts =
          contacts.page.length > 0 ? 'searched' : 'searched (no matches)';
      } else {
        sources.contacts = 'access denied for your role';
      }
    }

    // Leg 4 — products (lexical).
    if (runLeg('product')) {
      if (productsAllowed) {
        const products = await ctx.runQuery(
          internal.products.internal_queries.queryProducts,
          {
            organizationId: who.organizationId,
            searchTerm: query,
            paginationOpts: {
              numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
              cursor: null,
            },
          },
        );
        for (const product of products.page) {
          results.push(productResultEntry(product));
        }
        sources.products =
          products.page.length > 0 ? 'searched' : 'searched (no matches)';
      } else {
        sources.products = 'access denied for your role';
      }
    }

    // Leg 5 — registered websites (domain metadata; pages are leg 1).
    if (runLeg('website')) {
      if (websitesAllowed) {
        const websites = await ctx.runQuery(
          internal.websites.internal_queries.listWebsiteSummaries,
          { organizationId: who.organizationId },
        );
        const needle = query.toLowerCase();
        const matches = websites.filter(
          (site) =>
            site.domain.toLowerCase().includes(needle) ||
            (site.title ?? '').toLowerCase().includes(needle) ||
            (site.description ?? '').toLowerCase().includes(needle),
        );
        for (const site of matches.slice(0, RAG_SEARCH_ENTITY_LIMIT)) {
          results.push(websiteResultEntry(site));
        }
        sources.websites =
          matches.length > 0 ? 'searched' : 'searched (no matches)';
      } else {
        sources.websites = 'access denied for your role';
      }
    }

    // Legs 6–7 — the organization's work. Scoped by the readable project set
    // the turn already resolved: a task has no ACL of its own, so its parent
    // project's is the only correct filter. Passing organizationId alone to an
    // RLS-bypassing query — the shape legs 3–4 safely use — would hand every
    // project's work to any member, because those tables are org-scope-only and
    // work is not.
    if (runLeg('task', 'project')) {
      if (tasksAllowed || projectsAllowed) {
        const access = await knowledgeAccess();
        const projectIds = [...access.projectIds];
        const archivedProjectIds = new Set(access.archivedProjectIds ?? []);

        // Leg 6 — tasks (question-aware; open/status filter).
        if (runLeg('task')) {
          if (tasksAllowed) {
            const tasks = await ctx.runQuery(
              internal.tasks.search_for_chat.searchTasksForChat,
              {
                organizationId: who.organizationId,
                projectIds,
                term: query,
                ...(statusFilter !== undefined ? { status: statusFilter } : {}),
                paginationOpts: {
                  numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
                  cursor: null,
                },
              },
            );
            for (const task of tasks.page) {
              results.push(taskResultEntry(task, archivedProjectIds));
            }
            sources.tasks =
              tasks.page.length === 0
                ? 'searched (no matches)'
                : tasks.listed
                  ? listedSource('tasks', tasks.isDone)
                  : 'searched';
          } else {
            sources.tasks = 'access denied for your role';
          }
        }

        // Leg 7 — projects.
        if (runLeg('project')) {
          if (projectsAllowed) {
            const projects = await ctx.runQuery(
              internal.tasks.search_for_chat.searchProjectsForChat,
              {
                organizationId: who.organizationId,
                projectIds,
                term: query,
                paginationOpts: {
                  numItems: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
                  cursor: null,
                },
              },
            );
            for (const project of projects.page) {
              results.push(projectResultEntry(project, archivedProjectIds));
            }
            sources.projects =
              projects.page.length === 0
                ? 'searched (no matches)'
                : projects.listed
                  ? listedSource('projects', projects.isDone)
                  : 'searched';
          } else {
            sources.projects = 'access denied for your role';
          }
        }
      } else {
        if (runLeg('task')) sources.tasks = 'access denied for your role';
        if (runLeg('project')) {
          sources.projects = 'access denied for your role';
        }
      }
    }

    // Leg 8 — conversations. The narrowest leg by far: assignment privacy is
    // stricter than membership, so the query resolves the caller's own role and
    // teams and evaluates the SAME predicate `rls_rules.ts` uses. It is not
    // given an `isAdmin` flag to trust, and it is not handed organizationId
    // alone the way legs 3–4 safely are — those tables are org-scope-only and
    // an inbox is not.
    if (runLeg('conversation')) {
      if (conversationsAllowed) {
        const found = await ctx.runQuery(
          internal.conversations.search_for_chat.searchConversationsForChat,
          {
            organizationId: who.organizationId,
            userId: who.userId,
            term: query,
            limit: Math.min(limit, RAG_SEARCH_ENTITY_LIMIT),
          },
        );
        for (const conversation of found.conversations) {
          results.push(conversationResultEntry(conversation));
        }
        // A bounded scan that filled up must say so — otherwise "no matches"
        // reads as "the inbox holds nothing", which is a different claim.
        sources.conversations =
          found.conversations.length > 0
            ? found.truncated
              ? 'searched (recent conversations only)'
              : 'searched'
            : found.truncated
              ? 'searched (no matches among recent conversations)'
              : 'searched (no matches)';
      } else {
        sources.conversations = 'access denied for your role';
      }
    }

    // Every leg is already capped; no global slice. An empty answer says
    // what to do INSTEAD of searching again — the result payload is the
    // steer, not a system rule.
    return {
      status: 'ok',
      query,
      results,
      ...(results.length === 0
        ? {
            message:
              'No matches in the organization’s knowledge. Do not re-run ' +
              'reworded variants of this query. Browse a catalog with ' +
              'action "list" when you meant one, answer from what you ' +
              'already have — or, when a public page’s URL is known, read ' +
              'it with web_fetch.',
          }
        : {}),
      sources,
    };
  };

  // ------------------------------------------------------ rag_search · list

  /**
   * `action: 'list'` — one kind, no text predicate, honest paging.
   *
   * Every backend is the kind's EXISTING reader with its words turned off,
   * behind the same role gate and the same scope its search leg uses: a list
   * is a browse, never an ACL widening. The envelope always carries
   * `hasMore`, and `continueCursor` only when a next call can redeem it —
   * never an empty string, and never for the recency-bounded kinds
   * (conversations, websites), which say "narrow, not page" instead.
   */
  const ragSearchList = async (call: {
    kindRaw: unknown;
    query: string;
    statusRaw: unknown;
    projectId: string | undefined;
    cursorRaw: string | undefined;
    limitRaw: unknown;
  }): Promise<RagSearchOutcome> => {
    if (!isRagSearchKind(call.kindRaw)) {
      return invalidArgs(
        'action "list" needs "kind": one of ' +
          `${LISTABLE_KINDS.map((kind) => `"${kind}"`).join(', ')}. ` +
          `Example: ${EXAMPLE_LIST_CALL}.`,
      );
    }
    const kind = call.kindRaw;
    if (kind === 'web-page') {
      // `source-cards.tsx` keys web sources off a top-level `kind:
      // 'web-page'` in rag_fetch results — this refusal also keeps a list
      // envelope from ever colliding with that renderer.
      return invalidArgs(
        'Crawled pages cannot be listed. Browse the site catalog with ' +
          '{"action":"list","kind":"website"}, or search the pages with ' +
          'action "search".',
      );
    }
    if (call.query !== '') {
      const corrected = JSON.stringify({
        action: 'list',
        kind,
        ...(isWorkStatus(call.statusRaw) ? { status: call.statusRaw } : {}),
        ...(call.projectId !== undefined ? { projectId: call.projectId } : {}),
      });
      return invalidArgs(
        'action "list" takes filters, not a "query". Drop the query and ' +
          `re-call: ${corrected}. For a text match, use action "search".`,
      );
    }

    // A list is a page the model reads in full — the max IS the default.
    const limit =
      typeof call.limitRaw === 'number' && call.limitRaw > 0
        ? Math.min(Math.floor(call.limitRaw), RAG_SEARCH_MAX_LIMIT)
        : RAG_SEARCH_MAX_LIMIT;

    // Cursors are kind-tagged on the way out, so a stale or cross-kind value
    // is caught HERE instead of walking an index for a row that was never in
    // this list.
    let cursor: string | null = null;
    if (call.cursorRaw !== undefined) {
      if (kind === 'conversation' || kind === 'website') {
        return invalidArgs(
          `A ${kind} list does not page — re-call without "cursor" and ` +
            'narrow instead.',
        );
      }
      const prefix = `${kind}:`;
      const rest = call.cursorRaw.startsWith(prefix)
        ? call.cursorRaw.slice(prefix.length)
        : '';
      if (rest === '') {
        return invalidArgs(
          `That "cursor" is not from a ${kind} list. Pass the ` +
            '"continueCursor" the previous page of this list returned, or ' +
            'omit it for the first page.',
        );
      }
      cursor = rest;
    }

    const subject = LIST_READ_SUBJECTS[kind];
    if (!(await readAllowed(subject))) {
      return {
        status: 'unavailable',
        message: `Your role does not permit reading ${subject} in this organization.`,
      };
    }

    /** The standard honesty note; kinds with their own story pass a note. */
    const standardNote = (page: {
      count: number;
      hasMore: boolean;
      pageable: boolean;
    }): string | undefined => {
      if (page.hasMore && page.pageable) {
        return page.count === 0
          ? 'This page is empty but the walk is unfinished — pass ' +
              '"continueCursor" back as "cursor" to continue, or narrow ' +
              'the filters.'
          : LIST_PAGE_MESSAGE;
      }
      if (!page.hasMore && cursor !== null && page.count === 0) {
        return (
          'The list ended or changed since that cursor was issued — ' +
          're-call without "cursor" for a fresh first page.'
        );
      }
      return undefined;
    };

    const envelope = (page: {
      results: SearchResultEntry[];
      hasMore: boolean;
      continueCursor?: string;
      source: string;
      note?: string;
    }): RagSearchOk => ({
      status: 'ok',
      action: 'list',
      kind,
      results: page.results,
      hasMore: page.hasMore,
      ...(page.continueCursor !== undefined && page.continueCursor !== ''
        ? { continueCursor: `${kind}:${page.continueCursor}` }
        : {}),
      ...(page.note !== undefined ? { message: page.note } : {}),
      sources: { [LIST_SOURCE_KEYS[kind]]: page.source },
    });

    if (kind === 'task') {
      if (call.statusRaw !== undefined && !isWorkStatus(call.statusRaw)) {
        // A search drops an unknown status; an explicit LISTING of one must
        // not silently list everything instead.
        return invalidArgs(
          `Unknown "status" ${JSON.stringify(call.statusRaw)}. One of: ` +
            `${RAG_SEARCH_STATUS_VALUES.join(', ')}.`,
        );
      }
      const status = isWorkStatus(call.statusRaw) ? call.statusRaw : undefined;
      if (status === undefined && call.projectId === undefined) {
        return invalidArgs(
          'Listing every task in the workspace is refused — slice the ' +
            `board: pass "status" (e.g. ${EXAMPLE_LIST_CALL}) or ` +
            '"projectId" (an id from a project row\'s data).',
        );
      }
      const access = await knowledgeAccess();
      if (
        call.projectId !== undefined &&
        !access.projectIds.includes(call.projectId)
      ) {
        return invalidArgs(
          'No readable project with that "projectId" in this organization. ' +
            'Use the "data"."projectId" a previous task or project row ' +
            'carried.',
        );
      }
      const archivedProjectIds = new Set(access.archivedProjectIds ?? []);
      let tasks;
      try {
        tasks = await ctx.runQuery(
          internal.tasks.search_for_chat.searchTasksForChat,
          {
            organizationId: who.organizationId,
            projectIds: [...access.projectIds],
            term: '',
            list: true,
            excludeArchived: true,
            ...(status !== undefined ? { status } : {}),
            ...(call.projectId !== undefined
              ? { projectId: toId<'projects'>(call.projectId) }
              : {}),
            paginationOpts: { numItems: limit, cursor },
          },
        );
      } catch {
        // A malformed projectId fails the reader's arg validation — the
        // remedy is the same uniform message as an unreadable one.
        return invalidArgs(
          'No readable project with that "projectId" in this organization. ' +
            'Use the "data"."projectId" a previous task or project row ' +
            'carried.',
        );
      }
      const hasMore = !tasks.isDone;
      const results = tasks.page.map((task) =>
        taskResultEntry(task, archivedProjectIds),
      );
      return envelope({
        results,
        hasMore,
        ...(hasMore ? { continueCursor: tasks.continueCursor } : {}),
        source: hasMore ? 'listed (more — pass continueCursor)' : 'listed',
        ...(() => {
          const note = standardNote({
            count: results.length,
            hasMore,
            pageable: true,
          });
          return note !== undefined ? { note } : {};
        })(),
      });
    }

    if (kind === 'project') {
      const access = await knowledgeAccess();
      const archivedProjectIds = new Set(access.archivedProjectIds ?? []);
      const projects = await ctx.runQuery(
        internal.tasks.search_for_chat.searchProjectsForChat,
        {
          organizationId: who.organizationId,
          projectIds: [...access.projectIds],
          term: '',
          list: true,
          excludeArchived: true,
          paginationOpts: { numItems: limit, cursor },
        },
      );
      const hasMore = !projects.isDone;
      const results = projects.page.map((project) =>
        projectResultEntry(project, archivedProjectIds),
      );
      return envelope({
        results,
        hasMore,
        ...(hasMore ? { continueCursor: projects.continueCursor } : {}),
        source: hasMore ? 'listed (more — pass continueCursor)' : 'listed',
        ...(() => {
          const note = standardNote({
            count: results.length,
            hasMore,
            pageable: true,
          });
          return note !== undefined ? { note } : {};
        })(),
      });
    }

    if (kind === 'knowledge-entry') {
      const entries = await ctx.runQuery(
        internal.knowledge_entries.internal_queries.listEntriesForAgent,
        {
          organizationId: who.organizationId,
          paginationOpts: { numItems: limit, cursor },
        },
      );
      const hasMore = !entries.isDone;
      const results = entries.page.map((entry) =>
        knowledgeEntryResultEntry(entry),
      );
      return envelope({
        results,
        hasMore,
        ...(hasMore ? { continueCursor: entries.continueCursor } : {}),
        source: hasMore ? 'listed (more — pass continueCursor)' : 'listed',
        ...(() => {
          const note = standardNote({
            count: results.length,
            hasMore,
            pageable: true,
          });
          return note !== undefined ? { note } : {};
        })(),
      });
    }

    if (kind === 'contact') {
      const contacts = await ctx.runQuery(
        internal.contacts.internal_queries.queryContacts,
        {
          organizationId: who.organizationId,
          paginationOpts: { numItems: limit, cursor },
        },
      );
      const hasMore = !contacts.isDone;
      const results = contacts.page.map((contact) =>
        contactResultEntry(contact),
      );
      return envelope({
        results,
        hasMore,
        ...(hasMore ? { continueCursor: contacts.continueCursor } : {}),
        source: hasMore ? 'listed (more — pass continueCursor)' : 'listed',
        ...(() => {
          const note = standardNote({
            count: results.length,
            hasMore,
            pageable: true,
          });
          return note !== undefined ? { note } : {};
        })(),
      });
    }

    if (kind === 'product') {
      const products = await ctx.runQuery(
        internal.products.internal_queries.queryProducts,
        {
          organizationId: who.organizationId,
          paginationOpts: { numItems: limit, cursor },
        },
      );
      const hasMore = !products.isDone;
      const results = products.page.map((product) =>
        productResultEntry(product),
      );
      return envelope({
        results,
        hasMore,
        ...(hasMore ? { continueCursor: products.continueCursor } : {}),
        source: hasMore ? 'listed (more — pass continueCursor)' : 'listed',
        ...(() => {
          const note = standardNote({
            count: results.length,
            hasMore,
            pageable: true,
          });
          return note !== undefined ? { note } : {};
        })(),
      });
    }

    if (kind === 'website') {
      const websites = await ctx.runQuery(
        internal.websites.internal_queries.listWebsiteSummaries,
        { organizationId: who.organizationId },
      );
      const pageRows = websites.slice(0, limit);
      const hasMore = websites.length > pageRows.length;
      const results = pageRows.map((site) => ({
        ...websiteResultEntry(site),
        // The catalog answer "how big is each site?" — search rows skip it.
        ...(site.pageCount !== undefined
          ? { data: { pageCount: site.pageCount } }
          : {}),
      }));
      return envelope({
        results,
        hasMore,
        source: hasMore ? 'listed (first sites only)' : 'listed',
        ...(hasMore
          ? {
              note:
                `Only the first ${pageRows.length} sites are shown and ` +
                'this list does not page — search for a specific site ' +
                'instead.',
            }
          : {}),
      });
    }

    if (kind === 'conversation') {
      // Overfetch by one: the reader's `truncated` only reports a scan-cap
      // stop, so a full page from a bigger inbox would otherwise read as
      // complete (the limit-break leaves it false).
      const found = await ctx.runQuery(
        internal.conversations.search_for_chat.searchConversationsForChat,
        {
          organizationId: who.organizationId,
          userId: who.userId,
          term: '',
          list: true,
          limit: limit + 1,
        },
      );
      const overfetched = found.conversations.length > limit;
      const rows = overfetched
        ? found.conversations.slice(0, limit)
        : found.conversations;
      const hasMore = overfetched || found.truncated;
      const results = rows.map((conversation) =>
        conversationResultEntry(conversation),
      );
      return envelope({
        results,
        hasMore,
        source: hasMore
          ? 'listed (recent only — narrowing, not paging)'
          : 'listed',
        ...(hasMore
          ? {
              note:
                'Recent conversations only — this list does not page. ' +
                'Narrow by asking about a person, a topic, or a timeframe.',
            }
          : {}),
      });
    }

    if (kind === 'mail-attachment') {
      // Emailed attachments have no other listing surface: they are not
      // Document Hub rows, so they are absent from the Documents page and from
      // `kind="document"`. Scope is each attachment's conversation as it stands
      // now, decided by the same predicate and the same resolver the retrieval
      // gate uses.
      //
      // Overfetch by one so a full page never claims completeness — the
      // reader's own `truncated` only reports a scan-budget stop.
      const found = await ctx.runQuery(
        internal.file_metadata.internal_queries.listMailAttachmentsForChat,
        {
          organizationId: who.organizationId,
          userId: who.userId,
          limit,
        },
      );
      const rows = found.attachments;
      const hasMore = found.truncated;
      const results = rows.map((attachment): SearchResultEntry => ({
        kind: 'mail-attachment',
        title: attachment.fileName,
        // The corpus ref, so a listed attachment can be read with rag_fetch
        // instead of searched for by name.
        ref: attachment.ref,
        data: {
          conversationId: attachment.conversationId,
          contentType: attachment.contentType,
          sizeBytes: attachment.size,
          receivedAt: modelTimestamp(attachment.receivedAt),
          // A received-but-unindexed attachment cannot be fetched for its
          // text. Saying so beats implying it is readable.
          indexed: attachment.indexed,
        },
      }));
      return envelope({
        results,
        hasMore,
        source: hasMore
          ? 'listed (most recent only — narrowing, not paging)'
          : 'listed',
        ...(hasMore
          ? {
              note:
                'The most recently received attachments you can read, and ' +
                'this list does not page. Ask about a conversation, a ' +
                'correspondent, or a filename to reach older mail.',
            }
          : {}),
      });
    }

    // kind === 'document' — the hub listing, not the RAG chunk index: the
    // same reader the sandbox lane's document_find uses, scoped to the turn
    // user's teams (and one readable project when named).
    const offset = cursor !== null ? Number.parseInt(cursor, 10) : 0;
    if (
      cursor !== null &&
      (!Number.isInteger(offset) || offset < 0 || String(offset) !== cursor)
    ) {
      return invalidArgs(
        'That "cursor" is not from a document list. Pass the ' +
          '"continueCursor" the previous page returned, or omit it.',
      );
    }
    if (call.projectId !== undefined) {
      const access = await knowledgeAccess();
      if (!access.projectIds.includes(call.projectId)) {
        return invalidArgs(
          'No readable project with that "projectId" in this organization. ' +
            'Use the "data"."projectId" a previous task or project row ' +
            'carried.',
        );
      }
    }
    const found = await ctx.runQuery(
      internal.documents.internal_queries.listForAgent,
      {
        organizationId: who.organizationId,
        userId: who.userId,
        limit,
        ...(offset > 0 ? { cursor: offset } : {}),
        ...(call.projectId !== undefined ? { projectId: call.projectId } : {}),
      },
    );
    const hasMore = found.hasMore;
    const results = found.documents.map((doc): SearchResultEntry => ({
      kind: 'document',
      title: doc.title,
      ref: doc.fileId,
      data: {
        ...(doc.extension !== null ? { extension: doc.extension } : {}),
        ...(doc.folderPath !== null ? { folderPath: doc.folderPath } : {}),
        createdAt: modelTimestamp(doc.createdAt),
      },
    }));
    // Hub and team files are the whole catalog only for project-less asks —
    // project files stay behind their "projectId", and the source line says
    // so rather than presenting the hub as everything.
    const scopeLabel =
      call.projectId !== undefined
        ? 'project files'
        : 'hub and team files — project files need "projectId"';
    const warningNote = found.warning !== null ? found.warning : undefined;
    const pagingNote = standardNote({
      count: results.length,
      hasMore,
      pageable: true,
    });
    const note =
      warningNote !== undefined && pagingNote !== undefined
        ? `${pagingNote} ${warningNote}`
        : (pagingNote ?? warningNote);
    return envelope({
      results,
      hasMore,
      ...(hasMore && found.cursor !== null
        ? { continueCursor: String(found.cursor) }
        : {}),
      source: hasMore
        ? `listed (${scopeLabel}; more pages)`
        : `listed (${scopeLabel})`,
      ...(note !== undefined ? { note } : {}),
    });
  };

  // -------------------------------------------------------------- rag_fetch

  const ragFetch = async (args: Record<string, unknown>): Promise<unknown> => {
    const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
    if (ref === '') {
      const result = invalidArgs(
        'rag_fetch needs a "ref": a document file id or a crawled page URL.',
      );
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }
    const offset =
      typeof args.offset === 'number' && args.offset > 0
        ? Math.floor(args.offset)
        : 0;
    // An explicit range: `limit` caps the returned window below the default,
    // so the model can read exactly the region a search hit points at.
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(Math.floor(args.limit), FETCH_WINDOW_CHARS)
        : FETCH_WINDOW_CHARS;

    const isUrl = ref.startsWith('http://') || ref.startsWith('https://');
    const slug = await orgSlug();

    // A work ref from a search hit — the depth path for tasks. Checked before
    // the URL/document branches because the prefixes are unambiguous: a
    // document ref is a storage or `s3:` blob ref and a page ref is a URL, so
    // neither can begin with `task:`.
    if (ref.startsWith(WORK_REF_PREFIX.task)) {
      const taskId = ref.slice(WORK_REF_PREFIX.task.length);
      if (!(await readAllowed('tasks'))) {
        const result: ToolFailure = {
          status: 'unavailable',
          message:
            'Your role does not permit reading tasks in this organization.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      // ONE not_found message for every negative outcome — malformed id,
      // nonexistent task, other organization, or a project this user cannot
      // read. Byte-identical on purpose: a distinguishable refusal would turn
      // this into an existence oracle over another project's board.
      const missing: ToolFailure = {
        status: 'not_found',
        message:
          'No task with that ref is readable in this organization. Re-run ' +
          'rag_search and use a ref from its results.',
      };
      // Cheap scope check first, so a denied ref never pays for the expensive
      // context join (the sandbox lane's negative-read discipline). The catch
      // is load-bearing: `getTaskByIdInternal` validates `v.id('tasks')`, so a
      // model inventing a ref would THROW arg validation rather than return
      // null — and that must read as the same not_found as everything else.
      let scoped: Doc<'tasks'> | null = null;
      try {
        scoped = await ctx.runQuery(
          internal.tasks.internal_queries.getTaskByIdInternal,
          { taskId: toId<'tasks'>(taskId), organizationId: who.organizationId },
        );
      } catch {
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      if (scoped === null) {
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      // A ref is not a capability: re-derive project visibility now, because a
      // ref can be replayed on a later turn after access changed — exactly the
      // rule the document branch below applies.
      const workAccess = await knowledgeAccess();
      if (
        scoped.projectId != null &&
        !workAccess.projectIds.includes(String(scoped.projectId))
      ) {
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      const context = await ctx.runQuery(
        internal.tasks.internal_queries.getTaskContextForAgent,
        { taskId: scoped._id, organizationId: who.organizationId },
      );
      if (context === null) {
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      const description = context.task.description ?? '';
      const paged = windowText(description, offset, limit);
      await recordDispatch('rag_fetch', 'ok');
      return {
        status: 'ok',
        kind: 'task',
        ref,
        title: context.task.title,
        status_: context.task.status,
        ...(context.project !== null
          ? { project: context.project.name, projectKey: context.project.key }
          : {}),
        subtasks: context.subtasks,
        blockedBy: context.blockedBy,
        comments: context.comments,
        totalChars: paged.totalChars,
        offset,
        ...(paged.nextOffset !== undefined
          ? { nextOffset: paged.nextOffset }
          : {}),
        // A description and comments are user-authored: wrapped for the same
        // reason a fetched document is — content is data, never instructions.
        description: wrapUntrusted(paged.content, {
          tool: 'rag_fetch',
          url: ref,
        }),
      };
    }

    // A project ref answers "the row says 8 open tasks — which ones?". It used
    // to refuse with invalid_args, and a turn was observed calling it four
    // times and spending its whole step budget on the refusals. The model was
    // reaching for the right thing.
    if (ref.startsWith(WORK_REF_PREFIX.project)) {
      const projectId = ref.slice(WORK_REF_PREFIX.project.length);
      if (!(await readAllowed('tasks'))) {
        const result: ToolFailure = {
          status: 'unavailable',
          message:
            'Your role does not permit reading tasks in this organization.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      const missing: ToolFailure = {
        status: 'not_found',
        message:
          'No project with that ref is readable in this organization. Re-run ' +
          'rag_search and use a ref from its results.',
      };
      const access = await knowledgeAccess();
      // A ref is not a capability here either: the project must still be in
      // the caller's readable set on THIS turn.
      if (!access.projectIds.includes(projectId)) {
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      let tasks;
      try {
        tasks = await ctx.runQuery(
          internal.tasks.search_for_chat.searchTasksForChat,
          {
            organizationId: who.organizationId,
            projectIds: [...access.projectIds],
            projectId: toId<'projects'>(projectId),
            term: '',
            // An explicit listing, so the page size is honoured (the old
            // fallback pinned its own cap and `truncated` could never be
            // true). Archived tasks stay included and labelled, as before.
            list: true,
            paginationOpts: { numItems: PROJECT_TASKS_LIMIT, cursor: null },
          },
        );
      } catch {
        // A malformed id fails arg validation; it reads as the same not_found.
        await recordDispatch('rag_fetch', missing.status, missing.message);
        return missing;
      }
      await recordDispatch('rag_fetch', 'ok');
      return {
        status: 'ok',
        kind: 'project',
        ref,
        tasks: tasks.page.map((task) => ({
          ref: `${WORK_REF_PREFIX.task}${String(task._id)}`,
          title: task.title,
          status: task.status,
          ...(task.priority ? { priority: task.priority } : {}),
          ...archiveFlags({
            archivedAt: task.archivedAt,
            projectId,
            archivedProjectIds: new Set(access.archivedProjectIds ?? []),
          }),
        })),
        // A capped list must say it is capped, or "that is all of them" is a
        // claim the tool never made.
        truncated: !tasks.isDone,
      };
    }

    if (isUrl) {
      if (!(await readAllowed('websites'))) {
        const result: ToolFailure = {
          status: 'unavailable',
          message:
            'Your role does not permit reading websites in this organization.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      const page = await fetchWebPageByUrl(slug, ref);
      if (page === null) {
        const result: ToolFailure = {
          status: 'not_found',
          message:
            "No crawled page with that URL is in this organization's knowledge. " +
            'For a public page outside the knowledge base, use web_fetch.',
        };
        await recordDispatch('rag_fetch', result.status, result.message);
        return result;
      }
      const paged = windowText(page.text, offset, limit);
      await recordDispatch('rag_fetch', 'ok');
      return {
        status: 'ok',
        kind: 'web-page',
        url: page.url,
        ...(page.title !== null ? { title: page.title } : {}),
        ...(page.lastCrawledAt !== null
          ? { lastCrawledAt: page.lastCrawledAt }
          : {}),
        totalChars: paged.totalChars,
        offset,
        ...(paged.nextOffset !== undefined
          ? { nextOffset: paged.nextOffset }
          : {}),
        content: wrapUntrusted(paged.content, {
          tool: 'rag_fetch',
          url: page.url,
        }),
      };
    }

    // A document file id.
    if (!(await readAllowed('documents'))) {
      const result: ToolFailure = {
        status: 'unavailable',
        message:
          'Your role does not permit reading documents in this organization.',
      };
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }
    // The turn user's visibility gates the FETCH exactly like the search: a
    // ref in hand (quoted, guessed, remembered from before a scope change) is
    // not a capability, and a denied document reads as the same not_found as
    // a missing one.
    const access = await knowledgeAccess();
    const fromCorpus = await fetchDocumentByFileId(ctx, {
      organizationId: who.organizationId,
      orgSlug: slug,
      fileId: ref,
      access,
    });
    let filename = fromCorpus?.filename ?? null;
    let text =
      fromCorpus !== null && fromCorpus.text.length > 0
        ? fromCorpus.text
        : null;
    if (text === null) {
      // The corpus may not carry it (ingest offline, or a hub-authored
      // document whose text lives inline on the Convex row). The row carries
      // its own scope stamp — the same visibility rule applies before its
      // inline content is served.
      const row = await ctx.runQuery(
        internal.documents.internal_queries.findDocumentByFileId,
        { organizationId: who.organizationId, fileId: ref },
      );
      if (
        row &&
        // `teamTags` is the row's FULL team list (multi-team sharing);
        // visibility is "member of ANY of them", with the legacy single
        // `teamId` as the fallback — the same rule listing applies.
        knowledgeScopeAllows(access, {
          teamIds: row.teamTags ?? null,
          teamId: row.teamId ?? null,
          projectId: row.projectId ?? null,
        }) &&
        typeof row.content === 'string' &&
        row.content.length > 0
      ) {
        text = row.content;
        filename ??= row.title ?? null;
      }
    }
    if (text === null) {
      const result: ToolFailure = {
        status: 'not_found',
        message:
          'No readable content for that file id. The document may not be ' +
          'indexed yet — say so instead of guessing at its contents.',
      };
      await recordDispatch('rag_fetch', result.status, result.message);
      return result;
    }

    // A document that arrived through a video link is third-party content;
    // it reads wrapped, like every other untrusted source.
    let untrustedSourceUrl: string | undefined;
    try {
      const videoSources = await ctx.runQuery(
        internal.file_metadata.internal_queries.lookupVideoLinkSources,
        { storageIds: [ref] },
      );
      if (videoSources.length > 0) {
        untrustedSourceUrl = videoSources[0]?.sourceUrl ?? 'video-link';
      }
    } catch (error) {
      console.warn(
        `[chat] video-link source lookup failed for rag_fetch: ${describeError(error)}`,
      );
    }

    const paged = windowText(text, offset, limit);
    await recordDispatch('rag_fetch', 'ok');
    return {
      status: 'ok',
      kind: 'document',
      ref,
      ...(filename !== null ? { filename } : {}),
      totalChars: paged.totalChars,
      offset,
      ...(paged.nextOffset !== undefined
        ? { nextOffset: paged.nextOffset }
        : {}),
      content:
        untrustedSourceUrl !== undefined
          ? wrapUntrusted(paged.content, {
              tool: 'rag_fetch',
              url: untrustedSourceUrl,
            })
          : paged.content,
    };
  };

  // -------------------------------------------------------------- web_fetch

  const webFetch = async (args: Record<string, unknown>): Promise<unknown> => {
    const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
    if (rawUrl === '') {
      const result = invalidArgs('web_fetch needs a "url" string.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      const result = invalidArgs(`"${clip(rawUrl, 200)}" is not a valid URL.`);
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (parsed.protocol !== 'https:') {
      const result = invalidArgs('Only https:// URLs can be fetched.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      const result = invalidArgs('URLs with embedded credentials are refused.');
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    if (isPrivateIp(parsed.hostname) || /^[0-9.[\]:]+$/.test(parsed.hostname)) {
      const result = invalidArgs(
        'Bare IP or private-network hosts are refused — fetch a public site by name.',
      );
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }
    const offset =
      typeof args.offset === 'number' && args.offset > 0
        ? Math.floor(args.offset)
        : 0;
    const limit =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(Math.floor(args.limit), FETCH_WINDOW_CHARS)
        : FETCH_WINDOW_CHARS;

    let response;
    try {
      response = await safeFetch(parsed.toString(), {
        timeoutMs: WEB_FETCH_TIMEOUT_MS,
        maxResponseBytes: WEB_FETCH_MAX_RESPONSE_BYTES,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'user-agent': 'TaleAssistant/1.0 (+chat web_fetch)',
        },
      });
    } catch (error) {
      const message =
        error instanceof SafeFetchError
          ? `The page could not be fetched (${error.kind}${error.status !== undefined ? ` ${error.status}` : ''}).`
          : `The page could not be fetched: ${clip(describeError(error), 200)}`;
      const result: ToolFailure = { status: 'error', message };
      await recordDispatch('web_fetch', result.status, message);
      return result;
    }

    if (response.status >= 400) {
      const result: ToolFailure = {
        status: 'error',
        message: `The server answered ${response.status} ${response.statusText}.`,
      };
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml');
    const isTextual =
      isHtml ||
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType === '';
    if (!isTextual) {
      const result: ToolFailure = {
        status: 'unavailable',
        message: `The page is "${clip(contentType, 80)}", which this tool cannot read — only HTML and text.`,
      };
      await recordDispatch('web_fetch', result.status, result.message);
      return result;
    }

    const title = isHtml ? htmlTitle(response.body) : null;
    const text = isHtml ? htmlToText(response.body) : response.body;
    // Offsets index the EXTRACTED text, not response bytes — HTML positions
    // shift under extraction, so a Range request could never line up. Every
    // window therefore re-fetches the page and slices; the paging contract
    // (`offset`/`nextOffset`/`totalChars`) matches rag_fetch exactly.
    const paged = windowText(text, offset, limit);
    await recordDispatch('web_fetch', 'ok');
    return {
      status: 'ok',
      url: response.finalUrl,
      ...(title !== null ? { title } : {}),
      totalChars: paged.totalChars,
      offset,
      ...(paged.nextOffset !== undefined
        ? { nextOffset: paged.nextOffset }
        : {}),
      content: wrapUntrusted(paged.content, {
        tool: 'web_fetch',
        url: response.finalUrl,
      }),
    };
  };

  return { wireTools: CHAT_WIRE_TOOLS, execute };
}
