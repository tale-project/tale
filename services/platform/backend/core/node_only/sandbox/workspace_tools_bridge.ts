'use node';

import { wrapUntrusted } from '../../../../lib/chat/untrusted-content';
import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../../../lib/knowledge/types';
import { formatZodError } from '../../../../lib/shared/schemas/format-error';
import {
  MAX_OPTIONS_PER_QUESTION,
  MIN_OPTIONS_PER_QUESTION,
  questionSetSchema,
  type QuestionSet,
} from '../../../../lib/shared/schemas/questions';
import {
  FETCH_WINDOW_CHARS,
  fetchDocumentByFileId,
  fetchWebPageByUrl,
  windowText,
} from '../../knowledge/fetch';
import { searchKnowledge } from '../../knowledge/search';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import {
  ASK_HUMAN_TOOL,
  KNOWLEDGE_REFS_PER_CALL_CAP,
  WRITE_EFFECT_TOOLS,
} from '../../sandbox/tool_names';
import type { SessionActionSubject } from '../../sandbox/workspace_access';
import {
  isWorkspaceTaskTool,
  runDocumentCreate,
  runTaskTool,
  WORKSPACE_TASK_TOOLS,
} from './workspace_domain_tools';
import {
  isRecord,
  readCursor,
  readLimit,
  type BridgeBlocker,
  type ToolResult,
} from './workspace_tool_shared';

/**
 * The read-only workspace tools of the ORG's own data — org-scoped and
 * audited. The knowledge pair is every managed lane's baseline; the find
 * tools are granted per agent (the Tools picker / the agent node's `tools`
 * field, validated against `AGENT_TOOL_CATALOG`). The task family and
 * `document_create` are registered in `workspace_domain_tools.ts`.
 */
export const WORKSPACE_READ_TOOLS = [
  'rag_search',
  'rag_fetch',
  'document_find',
  'knowledge_entry_find',
  'contact_find',
  'product_find',
  'website_find',
] as const;

type WorkspaceReadTool = (typeof WORKSPACE_READ_TOOLS)[number];

/** Every tool this dispatch can serve, for the unknown-tool message. */
const ALL_WORKSPACE_TOOLS: readonly string[] = [
  ...WORKSPACE_READ_TOOLS,
  ...WORKSPACE_TASK_TOOLS,
  'document_create',
];

const WRITE_TOOL_SET: ReadonlySet<string> = new Set(WRITE_EFFECT_TOOLS);

/**
 * The role-matrix table each tool reads, for the per-dispatch access check.
 * Knowledge surfaces (RAG passages, hub listings, entries) all map to
 * `documents`: passages ARE document content and entries are document-backed,
 * so one subject governs the whole knowledge read path.
 */
const TOOL_READ_SUBJECT: Record<WorkspaceReadTool, SessionActionSubject> = {
  rag_search: 'documents',
  // A URL ref reads the crawled-pages corpus; the dispatch narrows the
  // subject to 'websites' per call — this entry is the file-id default.
  rag_fetch: 'documents',
  document_find: 'documents',
  knowledge_entry_find: 'documents',
  contact_find: 'contacts',
  product_find: 'products',
  website_find: 'websites',
};

/** Human-facing one-liners the status listing relays to the model. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  [ASK_HUMAN_TOOL]:
    'Ask the human operator of this automation run a question only they can ' +
    'answer (a business decision, a fact not in the files). Args: {question: ' +
    'string} — a COMPLETE, self-contained question (name the document, date, ' +
    'amount). When the answer is a CHOICE, also pass {questions: [{id, ' +
    'question, options: [{label, description, recommended?}]}]} so the ' +
    'operator picks instead of typing; omit it when the answer is genuinely ' +
    'open. When your research points at one option, mark THAT option with ' +
    'recommended: true (at most one per question) and put it first — the UI ' +
    'badges it on the answer itself; never write "recommended" into the ' +
    'label or description text. You may ' +
    'bundle several questions in one call. After a ' +
    'successful call, say you are waiting for the operator and END YOUR TURN ' +
    '— you will be resumed with the answer. Do not call it repeatedly for ' +
    'the same question.',
  rag_search:
    "Search the organization's knowledge base; returns the most relevant " +
    'passages with their text and the refs rag_fetch reads in full. ' +
    'Args: {query: string, limit?: number}.',
  rag_fetch:
    "Read one knowledge source's full text by the ref a rag_search hit " +
    'carried — a document file id or a crawled page URL. Args: {ref: string, ' +
    'offset?: number, limit?: number}; long content is windowed — pass the ' +
    "returned nextOffset as offset until it's absent.",
  document_find:
    'List/browse documents in the organization Documents hub this user can ' +
    'access. Args: {fileName?: string, extension?: string, limit?: number}.',
  knowledge_entry_find:
    "List the organization's curated knowledge entries (small per-topic " +
    'facts). Args: {topic?: string, limit?: number, cursor?: string} — topic ' +
    'is a contains-filter; prefer rag_search for semantic questions. Pass the ' +
    "previous result's continueCursor as cursor for the next page.",
  contact_find:
    "Search/list the organization's contacts (CRM). " +
    'Args: {searchTerm?: string, limit?: number, cursor?: string}. Pass the ' +
    "previous result's continueCursor as cursor for the next page.",
  product_find:
    "Search/list the organization's products/catalog. Args: {searchTerm?: " +
    'string, limit?: number, cursor?: string} — searchTerm matches ' +
    'name/description/category/tags/externalId (translations included). Pass ' +
    "the previous result's continueCursor as cursor for the next page.",
  website_find:
    "List the organization's connected websites (domain, title, page count). " +
    'Args: {} — no parameters.',
  task_find:
    "List tasks on the organization's boards. Args: {projectId?: string, " +
    'status?: "backlog"|"todo"|"in_progress"|"in_review"|"done"|"cancelled", ' +
    'assigneeId?: string, includeArchived?: boolean, limit?: number}. On a ' +
    "project-bound run the listing is fixed to the run's own project.",
  task_get:
    'Read one task in full — description, project, subtasks, blockers, and ' +
    'recent comments. Args: {taskId: string, commentLimit?: number}.',
  task_create:
    'Create a task. Args: {title: string, description?: string, projectId?: ' +
    "string (fixed to the run's project on a project-bound run; required on " +
    'an org-level run), priority?: "p0"|"p1"|"p2"|"p3", labels?: string[], ' +
    'status?: "backlog"|"todo" (default backlog), parentTaskId?: string}. ' +
    'Check for an existing task first — task_find, or ' +
    'task_upsert_by_external_ref for anything synced from an external system.',
  task_comment:
    "Add a markdown comment to a task's discussion. " +
    'Args: {taskId: string, body: string}.',
  task_update_status:
    'Move a task to another board column. Args: {taskId: string, status: ' +
    '"backlog"|"todo"|"in_progress"|"in_review"|"cancelled"}. Agents never ' +
    'set done — finished work parks at in_review for a human.',
  task_upsert_by_external_ref:
    'Idempotently sync ONE external item (an issue, a ticket, an alert) to a ' +
    'task, keyed by (externalSystem, externalId) — a re-run updates the ' +
    'existing task instead of duplicating it. Args: {externalSystem: string, ' +
    'externalId: string, title: string, description?: string, externalUrl?: ' +
    'string, labels?: string[], priority?: "p0"|"p1"|"p2"|"p3", ' +
    'externalState?: "open"|"closed" (closed applies the sync close policy), ' +
    'projectId?: string (as in task_create), createIfMissing?: boolean ' +
    '(default true), dedupeScope?: "org"|"project" (default org)}.',
  document_create:
    'Save a text document into the organization Documents hub. Args: {name: ' +
    'string (a file name, e.g. "report.md"), content: string, contentType?: ' +
    'string (default text/plain)}. The same name refreshes the same document ' +
    '(idempotent).',
};

/** The blocker a refused session-authority dispatch relays. `subject` names
 * the data domain in the role-denied case, so the model can tell the user
 * exactly what their role cannot reach. */
function actionContextBlocker(
  reason: 'no_access_context' | 'not_a_member' | 'read_denied',
  subject?: string,
): BridgeBlocker {
  if (reason === 'no_access_context') {
    return {
      code: 'no_access_context',
      guidance:
        'This session is neither bound to a project or automation run nor ' +
        'carries a user context that permits this tool, so it cannot run ' +
        'here. Tell the user; do not retry.',
    };
  }
  if (reason === 'not_a_member') {
    return {
      code: 'access_denied',
      guidance:
        'The user this turn runs as is not an active member of this ' +
        'organization, so workspace tools are unavailable. Tell the user; ' +
        'do not retry.',
    };
  }
  return {
    code: 'access_denied',
    guidance:
      `The user's role does not permit reading ${subject ?? 'this data'} in ` +
      'this organization. Tell the user; do not retry.',
  };
}

function isWorkspaceReadTool(tool: string): tool is WorkspaceReadTool {
  return (WORKSPACE_READ_TOOLS as readonly string[]).includes(tool);
}

/**
 * Run one read-only workspace tool for a sandbox external turn. The HTTP dispatch
 * has already authenticated the session token and checked the grant set; this
 * action owns tool-name validation and the org-scoped read as the turn's user.
 */
/** The dispatch as a PLAIN exported function — the internalAction below
 * wraps it, and the 0.5 backend's `/api/tools/execute` door calls it on the
 * ctx shim (same pattern as `chat/turn_action.executeTurn`). */
export async function dispatchWorkspaceToolImpl(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    userId?: string;
    mintedKeyId?: string;
    tool: string;
    callArgs: unknown;
  },
): Promise<ToolResult> {
  const result = await runWorkspaceTool(ctx, args);
  // Forensic trail: who/what/when/outcome + a sorted param-KEY fingerprint
  // (never values). RAG tools additionally record the distinct knowledge
  // refs the call served — the run's read-set for the provenance ledger.
  // Auditability is a bridge requirement; a logging failure must not fail
  // the call, so it's best-effort.
  const knowledgeRefs = knowledgeRefsOf(args.tool, result);
  await ctx
    .runMutation(internal.sandbox.session_mutations.recordToolCall, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      tool: args.tool,
      userId: args.userId,
      outcome: result.status,
      paramsFingerprint: isRecord(args.callArgs)
        ? Object.keys(args.callArgs).sort().join(',')
        : '',
      ...(knowledgeRefs !== undefined ? { knowledgeRefs } : {}),
      ...(args.mintedKeyId !== undefined
        ? { mintedKeyId: args.mintedKeyId }
        : {}),
    })
    .catch((err: unknown) =>
      console.warn('[workspace-tools] audit write failed:', err),
    );
  return result;
}
/**
 * The knowledge REFS a successful RAG call served — durable document identity
 * (a file id, or a URL for a crawled page), never content or snippets.
 * `rag_search` yields its hits' refs; a fetch-shaped result (`rag_fetch`, if
 * granted on this surface later) yields the one ref it read. Distinct, order
 * preserved, truncated at {@link KNOWLEDGE_REFS_PER_CALL_CAP}. `undefined`
 * for non-RAG tools and failed calls, so their rows carry no field at all.
 */
function knowledgeRefsOf(
  tool: string,
  result: ToolResult,
): string[] | undefined {
  if (tool !== 'rag_search' && tool !== 'rag_fetch') return undefined;
  if (result.status !== 'ok' || !isRecord(result.output)) return undefined;

  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (ref: unknown): void => {
    if (typeof ref !== 'string' || ref === '' || seen.has(ref)) return;
    seen.add(ref);
    if (refs.length < KNOWLEDGE_REFS_PER_CALL_CAP) refs.push(ref);
  };

  if (Array.isArray(result.output.hits)) {
    // The search shape: `KnowledgeResult.hits[].source.ref`.
    for (const hit of result.output.hits) {
      if (isRecord(hit) && isRecord(hit.source)) push(hit.source.ref);
    }
  } else {
    // The fetch shape: one document ref or page URL.
    push(result.output.ref);
    push(result.output.url);
  }
  return refs.length > 0 ? refs : undefined;
}

async function runWorkspaceTool(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    userId?: string;
    tool: string;
    callArgs: unknown;
  },
): Promise<ToolResult> {
  const callArgs = isRecord(args.callArgs) ? args.callArgs : {};
  // Captured before the guard narrows `args.tool`: the fallback below runs
  // exactly when the narrowing left nothing (`never`), so it needs the raw
  // requested name to still be a plain string.
  const requestedTool: string = args.tool;

  // Not an org-data read: no turn user required (an automation run carries
  // none), no role matrix — the ask attaches to the run the SESSION proves,
  // and the answer side has its own membership gate.
  if (args.tool === ASK_HUMAN_TOOL) {
    return await runAskHuman(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      callArgs,
    });
  }

  // The task family and document_create act with the session's OWN authority
  // (binding first, user-read fallback — writes and tasks are binding-only),
  // resolved once here and handed to the domain handlers.
  if (isWorkspaceTaskTool(args.tool) || args.tool === 'document_create') {
    const context = await ctx.runQuery(
      internal.sandbox.workspace_access.resolveSessionActionContext,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        ...(args.userId !== undefined ? { userId: args.userId } : {}),
        subject: args.tool === 'document_create' ? 'documents' : 'tasks',
        effect: WRITE_TOOL_SET.has(args.tool) ? 'write' : 'read',
      },
    );
    if (!context.allowed) {
      return {
        status: 'unavailable',
        blockers: [
          actionContextBlocker(
            context.reason,
            args.tool === 'document_create' ? 'documents' : 'tasks',
          ),
        ],
      };
    }
    const authority = { actorId: context.actorId, scope: context.scope };
    if (args.tool === 'document_create') {
      return await runDocumentCreate(ctx, {
        organizationId: args.organizationId,
        callArgs,
        authority,
      });
    }
    return await runTaskTool(ctx, {
      organizationId: args.organizationId,
      tool: args.tool,
      callArgs,
      authority,
    });
  }

  if (!isWorkspaceReadTool(args.tool)) {
    return {
      status: 'invalid_args',
      message:
        `Unknown workspace tool "${args.tool}". ` +
        `Available: ${ALL_WORKSPACE_TOOLS.join(', ')}. Call workspace_status to see what is granted.`,
    };
  }

  // The knowledge pair resolves its visibility from the SESSION's binding
  // first (a project-bound run reads its project + the org hub; an org-level
  // automation run reads the hub), falling back to the turn user's own scope
  // — so it runs on the user-less task/automation tokens.
  if (args.tool === 'rag_search' || args.tool === 'rag_fetch') {
    return await runKnowledgeTool(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.userId !== undefined ? { userId: args.userId } : {}),
      tool: args.tool,
      callArgs,
    });
  }

  // Binding first for the org-data find tools: a user-less task/automation
  // token reads with its deploy-time binding's authority; a user token reads
  // as its user — the same membership + role matrix the user-side RLS
  // queries consult, re-resolved per dispatch (a revoked or downgraded
  // member loses the tools on their next call, not at the next session).
  if (args.tool === 'document_find') {
    // The Documents hub is scope-shaped (teams + project + hub), so the two
    // authority sources list through two doors onto ONE helper:
    // binding → `listDocumentsForScope`, user → `listForAgent`.
    const bound = await resolveKnowledgeAccess(
      ctx,
      { organizationId: args.organizationId, sessionId: args.sessionId },
      'documents',
    );
    if (bound.allowed) {
      const page = await ctx.runQuery(
        internal.documents.internal_queries.listDocumentsForScope,
        {
          organizationId: args.organizationId,
          teamIds: [...bound.scope.teamIds],
          // EVERY authorized project — a multi-bound automation's run lists
          // the files of all its bound projects, not the first one's.
          ...(bound.scope.projectIds.length > 0
            ? { projectIds: [...bound.scope.projectIds] }
            : {}),
          ...(typeof callArgs.fileName === 'string'
            ? { fileName: callArgs.fileName }
            : {}),
          ...(typeof callArgs.extension === 'string'
            ? { extension: callArgs.extension }
            : {}),
          limit: readLimit(callArgs.limit, 50),
        },
      );
      return { status: 'ok', output: page };
    }
    if (args.userId === undefined) {
      return {
        status: 'unavailable',
        blockers: [KNOWLEDGE_ACCESS_BLOCKERS[bound.reason]],
      };
    }
    const access = await ctx.runQuery(
      internal.sandbox.workspace_access.resolveWorkspaceReadAccess,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        subject: 'documents',
      },
    );
    if (!access.allowed) {
      return {
        status: 'unavailable',
        blockers: [actionContextBlocker(access.reason, 'documents')],
      };
    }
    const page = await ctx.runQuery(
      internal.documents.internal_queries.listForAgent,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        ...(typeof callArgs.fileName === 'string'
          ? { fileName: callArgs.fileName }
          : {}),
        ...(typeof callArgs.extension === 'string'
          ? { extension: callArgs.extension }
          : {}),
        limit: readLimit(callArgs.limit, 50),
      },
    );
    return { status: 'ok', output: page };
  }

  // The remaining find tools are org-wide reads behind the same binding-first
  // door, then plain org-scoped internal queries.
  const context = await ctx.runQuery(
    internal.sandbox.workspace_access.resolveSessionActionContext,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.userId !== undefined ? { userId: args.userId } : {}),
      subject: TOOL_READ_SUBJECT[args.tool],
      effect: 'read',
    },
  );
  if (!context.allowed) {
    return {
      status: 'unavailable',
      blockers: [
        actionContextBlocker(context.reason, TOOL_READ_SUBJECT[args.tool]),
      ],
    };
  }

  if (args.tool === 'knowledge_entry_find') {
    const page = await ctx.runQuery(
      internal.knowledge_entries.internal_queries.listEntriesForAgent,
      {
        organizationId: args.organizationId,
        ...(typeof callArgs.topic === 'string' && callArgs.topic.trim() !== ''
          ? { topic: callArgs.topic }
          : {}),
        paginationOpts: {
          numItems: readLimit(callArgs.limit, 50),
          cursor: readCursor(callArgs.cursor),
        },
      },
    );
    return { status: 'ok', output: page };
  }

  // The org data domains — org-scoped internal reads behind the access gate
  // above, cursor-paginated so a big catalog pages instead of truncating.
  if (args.tool === 'contact_find') {
    const page = await ctx.runQuery(
      internal.contacts.internal_queries.queryContacts,
      {
        organizationId: args.organizationId,
        ...(typeof callArgs.searchTerm === 'string'
          ? { searchTerm: callArgs.searchTerm }
          : {}),
        paginationOpts: {
          numItems: readLimit(callArgs.limit, 50),
          cursor: readCursor(callArgs.cursor),
        },
      },
    );
    return { status: 'ok', output: page };
  }

  if (args.tool === 'product_find') {
    const page = await ctx.runQuery(
      internal.products.internal_queries.queryProducts,
      {
        organizationId: args.organizationId,
        ...(typeof callArgs.searchTerm === 'string'
          ? { searchTerm: callArgs.searchTerm }
          : {}),
        paginationOpts: {
          numItems: readLimit(callArgs.limit, 50),
          cursor: readCursor(callArgs.cursor),
        },
      },
    );
    return { status: 'ok', output: page };
  }

  if (args.tool === 'website_find') {
    const websites = await ctx.runQuery(
      internal.websites.internal_queries.listWebsiteSummaries,
      { organizationId: args.organizationId },
    );
    return { status: 'ok', output: { websites } };
  }

  // Unreachable: the known-tool check above already answered. Kept as the
  // exhaustive fallback so a tool added to WORKSPACE_READ_TOOLS without a
  // handler fails loudly instead of silently returning nothing.
  return {
    status: 'error',
    message: `Workspace tool "${requestedTool}" has no handler.`,
  };
}

// ---------------------------------------------------------------------------
// The knowledge pair — rag_search / rag_fetch
// ---------------------------------------------------------------------------

/** Resolve what this dispatch may read — the session's binding first, then
 * the turn user (role-checked for `subject`), else refused. */
async function resolveKnowledgeAccess(
  ctx: ActionCtx,
  args: { organizationId: string; sessionId: string; userId?: string },
  subject: 'documents' | 'websites',
): Promise<
  | { allowed: true; scope: KnowledgeAccessScope }
  | {
      allowed: false;
      reason: 'no_access_context' | 'not_a_member' | 'read_denied';
    }
> {
  return await ctx.runQuery(
    internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.userId !== undefined ? { userId: args.userId } : {}),
      subject,
    },
  );
}

/** The blocker a refused knowledge dispatch relays, by refusal reason. */
const KNOWLEDGE_ACCESS_BLOCKERS: Record<
  'no_access_context' | 'not_a_member' | 'read_denied',
  BridgeBlocker
> = {
  no_access_context: {
    code: 'no_access_context',
    guidance:
      'This session is neither bound to a project nor carries a user ' +
      'context, so knowledge reads cannot run from it.',
  },
  not_a_member: {
    code: 'access_denied',
    guidance:
      'The user this turn runs as is not an active member of this ' +
      'organization, so knowledge reads are unavailable. Tell the user; ' +
      'do not retry.',
  },
  read_denied: {
    code: 'access_denied',
    guidance:
      "The user's role does not permit reading this content in this " +
      'organization. Tell the user; do not retry.',
  },
};

/** The retrieval backends REFUSE (throw) when the org has no embedding model
 * configured or its corpus/pool is unusable — surfaced as guidance, not a
 * transport error, so the agent tells the user instead of retrying. */
function knowledgeUnavailable(error: unknown): ToolResult {
  // Same split as the chat leg: the real error to the log, a stable sentence
  // to the agent. There is no Settings → Knowledge page — the embedding
  // configuration lives under Settings → Data residency, and pointing an
  // operator at a page that does not exist is worse than saying nothing.
  console.warn(
    `[sandbox] knowledge retrieval unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
  return {
    status: 'unavailable',
    blockers: [
      {
        code: 'knowledge_unavailable',
        guidance:
          'Knowledge retrieval is not available for this organization ' +
          '(no embedding model configured, or the knowledge base is ' +
          'empty). An administrator sets it up under Settings → Data ' +
          'residency. Do not guess at the cause.',
      },
    ],
  };
}

async function runKnowledgeTool(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    userId?: string;
    tool: 'rag_search' | 'rag_fetch';
    callArgs: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const { callArgs } = args;

  if (args.tool === 'rag_search') {
    const query =
      typeof callArgs.query === 'string' ? callArgs.query.trim() : '';
    if (query === '') {
      return {
        status: 'invalid_args',
        message: 'rag_search needs a non-empty "query" string.',
      };
    }
    const limit =
      typeof callArgs.limit === 'number' && callArgs.limit > 0
        ? Math.min(Math.floor(callArgs.limit), 20)
        : 8;
    const access = await resolveKnowledgeAccess(ctx, args, 'documents');
    if (!access.allowed) {
      return {
        status: 'unavailable',
        blockers: [KNOWLEDGE_ACCESS_BLOCKERS[access.reason]],
      };
    }
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    try {
      const result = await searchKnowledge(ctx, {
        organizationId: args.organizationId,
        orgSlug,
        query,
        limit,
        access: access.scope,
      });
      return { status: 'ok', output: result };
    } catch (error) {
      return knowledgeUnavailable(error);
    }
  }

  const ref = typeof callArgs.ref === 'string' ? callArgs.ref.trim() : '';
  if (ref === '') {
    return {
      status: 'invalid_args',
      message:
        'rag_fetch needs a "ref": a document file id or a crawled page URL.',
    };
  }
  const offset =
    typeof callArgs.offset === 'number' && callArgs.offset > 0
      ? Math.floor(callArgs.offset)
      : 0;
  // An explicit range: `limit` caps the returned window below the default,
  // so the model can read exactly the region a search hit points at.
  const limit =
    typeof callArgs.limit === 'number' && callArgs.limit > 0
      ? Math.min(Math.floor(callArgs.limit), FETCH_WINDOW_CHARS)
      : FETCH_WINDOW_CHARS;
  const isUrl = ref.startsWith('http://') || ref.startsWith('https://');

  // A URL ref reads the crawled-pages corpus; a file id reads documents.
  const access = await resolveKnowledgeAccess(
    ctx,
    args,
    isUrl ? 'websites' : 'documents',
  );
  if (!access.allowed) {
    return {
      status: 'unavailable',
      blockers: [KNOWLEDGE_ACCESS_BLOCKERS[access.reason]],
    };
  }
  const orgSlug = await orgSlugFromId(ctx, args.organizationId);

  if (isUrl) {
    let page;
    try {
      page = await fetchWebPageByUrl(orgSlug, ref);
    } catch (error) {
      return knowledgeUnavailable(error);
    }
    if (page === null) {
      return {
        status: 'not_found',
        message:
          "No crawled page with that URL is in this organization's " +
          'knowledge. For a public page outside the knowledge base, fetch ' +
          'it yourself over the network.',
      };
    }
    const paged = windowText(page.text, offset, limit);
    return {
      status: 'ok',
      output: {
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
        // Crawled third-party content reads wrapped, like every other
        // untrusted source.
        content: wrapUntrusted(paged.content, {
          tool: 'rag_fetch',
          url: page.url,
        }),
      },
    };
  }

  // A document file id. The dispatch's scope gates the fetch exactly like the
  // search: a ref in hand (quoted, guessed, remembered from before a scope
  // change) is not a capability, and a denied document reads as the same
  // not_found as a missing one.
  let fromCorpus;
  try {
    fromCorpus = await fetchDocumentByFileId(ctx, {
      organizationId: args.organizationId,
      orgSlug,
      fileId: ref,
      access: access.scope,
    });
  } catch (error) {
    return knowledgeUnavailable(error);
  }
  let filename = fromCorpus?.filename ?? null;
  let text =
    fromCorpus !== null && fromCorpus.text.length > 0 ? fromCorpus.text : null;
  if (text === null) {
    // The corpus may not carry it (ingest offline, or a hub-authored
    // document whose text lives inline on the Convex row). The row carries
    // its own scope stamp — the same visibility rule applies before its
    // inline content is served.
    const row = await ctx.runQuery(
      internal.documents.internal_queries.findDocumentByFileId,
      { organizationId: args.organizationId, fileId: ref },
    );
    if (
      row &&
      knowledgeScopeAllows(access.scope, {
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
    return {
      status: 'not_found',
      message:
        'No readable content for that file id. The document may not be ' +
        "indexed yet, or it is outside this run's scope — rag_search shows " +
        'what is reachable.',
    };
  }

  // A document that arrived through a video link is third-party content; it
  // reads wrapped, like every other untrusted source.
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
      `[workspace-tools] video-link source lookup failed for rag_fetch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const paged = windowText(text, offset, limit);
  return {
    status: 'ok',
    output: {
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
    },
  };
}

/**
 * `ask_human`: register a question for the run's operator. The session names
 * the run (verified server-side against its live agent cursor); the question
 * mirrors onto the task timeline when the run has a task subject. The tool
 * result tells the model to END ITS TURN — the host parks the node on the
 * pending ask and resumes this same conversation once someone answers.
 */
async function runAskHuman(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    callArgs: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const question =
    typeof args.callArgs.question === 'string'
      ? args.callArgs.question.trim()
      : '';
  if (question === '') {
    return {
      status: 'invalid_args',
      message:
        'ask_human needs a non-empty "question" string — a complete, ' +
        'self-contained question the operator can answer without seeing ' +
        'your session.',
    };
  }
  // Choices are OPTIONAL here, unlike chat's `ask_question`. A run's blocker
  // is often genuinely open ("what is the staging URL?"), and forcing four
  // invented options onto that is worse than one honest box. When the agent
  // DOES know the answers, the operator gets the same one-at-a-time flow the
  // chat composer shows. A malformed set is refused rather than silently
  // dropped, so the agent learns the shape instead of wondering why its
  // options vanished.
  let questions: QuestionSet | undefined;
  if (args.callArgs.questions !== undefined) {
    const parsed = questionSetSchema.safeParse({
      questions: args.callArgs.questions,
    });
    if (!parsed.success) {
      return {
        status: 'invalid_args',
        message:
          `The "questions" list is not usable (${formatZodError(parsed.error)}). ` +
          `Give each question an id, the question text, and ${MIN_OPTIONS_PER_QUESTION}-${MAX_OPTIONS_PER_QUESTION} ` +
          'options — or omit "questions" entirely and just ask in "question".',
      };
    }
    questions = parsed.data;
  }
  const created = await ctx.runMutation(
    internal.automations.human_asks.createAskForExec,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      question,
      ...(questions !== undefined ? { questions } : {}),
    },
  );
  if ('refused' in created) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'no_live_run',
          guidance: `The question could not be registered: ${created.refused}. Finish the task with what you have and note the open question in your summary.`,
        },
      ],
    };
  }
  // Timeline mirror — the operator may live in the task view; a failed mirror
  // never fails the ask (the panel card is the primary surface).
  if (created.taskId !== undefined) {
    await ctx
      .runMutation(internal.tasks.internal_mutations.agentAddComment, {
        organizationId: args.organizationId,
        actorId: 'workflow',
        taskId: created.taskId,
        body: `[automated] 🙋 **Question for you** — the agent working on this task is waiting for your answer:\n\n> ${question.replaceAll('\n', '\n> ')}\n\nAnswer it from this task's assistant panel — the run resumes automatically once you submit.`,
      })
      .catch((err: unknown) =>
        console.warn('[workspace-tools] ask_human comment mirror failed:', err),
      );
  }
  return {
    status: 'ok',
    output: {
      registered: true,
      questionId: String(created.askId),
      guidance:
        'The operator has been asked. Now say briefly that you are waiting ' +
        'for their answer and END YOUR TURN — you will be resumed with the ' +
        'answer as your next message. Do not poll, do not repeat the call.',
    },
  };
}

/**
 * List the workspace tools this agent is granted, with descriptions the model
 * relays. Grants come from the session token row (never the request), so the
 * listing is exactly what the turn was provisioned with.
 */
export function workspaceToolStatusImpl(grants: readonly string[]): unknown {
  if (grants.length === 0) {
    return {
      tools: [],
      note: 'No workspace tools are granted to this agent.',
    };
  }
  return {
    tools: grants.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name] ?? 'A platform workspace tool.',
      readOnly: !WRITE_TOOL_SET.has(name),
    })),
  };
}
