'use node';

/**
 * Server side of the in-sandbox WORKSPACE-TOOL bridge
 * (`tale-connectors-mcp` `workspace_tool`/`workspace_status` →
 * `/api/tools/{execute,status}`). The first-party counterpart of
 * `connectors_bridge.ts`: where that surface reaches the org's third-party
 * connectors, this one reaches the org's OWN platform data — knowledge and the
 * Documents hub — as read-only tools.
 *
 * Same discipline as the connector surface: whatever these actions return is
 * relayed verbatim to the external agent as the tool result, so every shape is
 * written FOR THE MODEL (structured status + guidance, never a bare throw).
 * Access is re-resolved per dispatch from what the token PROVES, never from
 * the request. The knowledge pair (`rag_search`/`rag_fetch`) derives its
 * visibility from the SESSION's binding first — a project-bound run reads its
 * project + the org hub, an org-level automation run reads the hub — falling
 * back to the turn user's own scope (`resolveKnowledgeToolAccess`), so it
 * runs on the user-less task/automation tokens. The org-data find tools run
 * AS the turn's user: active membership + the role matrix for the table the
 * tool exposes (`resolveWorkspaceReadAccess`), the same policy the user-side
 * `queryWithRLS` reads enforce. V1 is READ-ONLY (a write tool would need the
 * approvals lane an async turn can't answer), matching the connector bridge's
 * stance.
 *
 * `'use node'` because knowledge search binds an embedder (filesystem/network).
 */

import { v } from 'convex/values';

import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../../lib/knowledge/types';
import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import {
  FETCH_WINDOW_CHARS,
  fetchDocumentByFileId,
  fetchWebPageByUrl,
  windowText,
} from '../../knowledge/fetch';
import { searchKnowledge } from '../../knowledge/search';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import type { AgentReadSubject } from '../../lib/rls/helpers/agent_read_access';
import { wrapUntrusted } from '../../lib/untrusted_content';
import {
  ASK_HUMAN_TOOL,
  KNOWLEDGE_REFS_PER_CALL_CAP,
} from '../../sandbox/tool_names';

/**
 * The read-only workspace tools a managed external turn is granted by default.
 * These are first-party reads of the ORG's own data — org-scoped and audited —
 * so a default read grant is honest without a per-agent picker (the agent
 * Tools-tab UI was retired). The names match the descriptions baked into the
 * shipped `tale-connectors-mcp` shim, so the model's tool guidance is
 * accurate. A write tool is deliberately absent in V1.
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

/**
 * The role-matrix table each tool reads, for the per-dispatch access check.
 * Knowledge surfaces (RAG passages, hub listings, entries) all map to
 * `documents`: passages ARE document content and entries are document-backed,
 * so one subject governs the whole knowledge read path.
 */
const TOOL_READ_SUBJECT: Record<WorkspaceReadTool, AgentReadSubject> = {
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
    'amount). You may bundle several questions in one call. After a ' +
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
};

interface BridgeBlocker {
  code: string;
  guidance: string;
}
type ToolResult =
  | { status: 'ok'; output: unknown }
  | { status: 'unavailable'; blockers: BridgeBlocker[] }
  | { status: 'invalid_args'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWorkspaceReadTool(tool: string): tool is WorkspaceReadTool {
  return (WORKSPACE_READ_TOOLS as readonly string[]).includes(tool);
}

/**
 * Run one read-only workspace tool for a sandbox external turn. The HTTP dispatch
 * has already authenticated the session token and checked the grant set; this
 * action owns tool-name validation and the org-scoped read as the turn's user.
 */
export const dispatchWorkspaceTool = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    /** The turn's user — absent on task/automation run tokens, whose tools
     * (`ask_human`, the knowledge pair) resolve access from the session's
     * binding instead. */
    userId: v.optional(v.string()),
    /** The per-turn gateway VK id off the session-token row (HTTP dispatch
     * auth, never the request body) — `recordToolCall` resolves it to the
     * exec it was minted for, pinning the audit row to one turn. */
    mintedKeyId: v.optional(v.string()),
    tool: v.string(),
    callArgs: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ToolResult> => {
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
  },
});

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

  if (!isWorkspaceReadTool(args.tool)) {
    return {
      status: 'invalid_args',
      message:
        `Unknown workspace tool "${args.tool}". ` +
        `Available: ${WORKSPACE_READ_TOOLS.join(', ')}. Call workspace_status to see what is granted.`,
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

  // The org-data find tools run AS the turn's user; without one the read
  // cannot be access-scoped, so it cannot run.
  if (args.userId === undefined) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'no_user_context',
          guidance:
            'This session token carries no user context, so workspace reads cannot run from it.',
        },
      ],
    };
  }
  const userId = args.userId;

  // The session token names the user this turn runs as; whether that user may
  // still READ is re-resolved per dispatch from the same membership + role
  // matrix the user-side RLS queries consult. A revoked or downgraded member
  // loses the workspace tools on their next call, not at the next session.
  const subject = TOOL_READ_SUBJECT[args.tool];
  const access = await ctx.runQuery(
    internal.sandbox.workspace_access.resolveWorkspaceReadAccess,
    { organizationId: args.organizationId, userId, subject },
  );
  if (!access.allowed) {
    return {
      status: 'unavailable',
      blockers: [
        {
          code: 'access_denied',
          guidance:
            access.reason === 'not_a_member'
              ? 'The user this turn runs as is not an active member of this ' +
                'organization, so workspace reads are unavailable. Tell the ' +
                'user; do not retry.'
              : `The user's role does not permit reading ${subject} in this ` +
                'organization. Tell the user; do not retry.',
        },
      ],
    };
  }

  if (args.tool === 'document_find') {
    const page = await ctx.runQuery(
      internal.documents.internal_queries.listForAgent,
      {
        organizationId: args.organizationId,
        userId,
        ...(typeof callArgs.fileName === 'string'
          ? { fileName: callArgs.fileName }
          : {}),
        ...(typeof callArgs.extension === 'string'
          ? { extension: callArgs.extension }
          : {}),
        limit:
          typeof callArgs.limit === 'number' && callArgs.limit > 0
            ? Math.min(Math.floor(callArgs.limit), 50)
            : 20,
      },
    );
    return { status: 'ok', output: page };
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
  return {
    status: 'unavailable',
    blockers: [
      {
        code: 'knowledge_unavailable',
        guidance:
          'Knowledge retrieval is not available for this organization ' +
          '(no embedding model configured, or the knowledge base is ' +
          'empty). Ask the user to set it up under Settings → Knowledge. ' +
          `(${error instanceof Error ? error.message : String(error)})`,
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
  const created = await ctx.runMutation(
    internal.automations.human_asks.createAskForExec,
    {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      question,
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

/** A caller-supplied `limit`, floored to a positive int and capped. */
function readLimit(raw: unknown, cap: number): number {
  return typeof raw === 'number' && raw > 0
    ? Math.min(Math.floor(raw), cap)
    : Math.min(20, cap);
}

/** A caller-supplied continuation cursor: a non-empty string, else page one. */
function readCursor(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * List the workspace tools this agent is granted, with descriptions the model
 * relays. Grants come from the session token row (never the request), so the
 * listing is exactly what the turn was provisioned with.
 */
export const workspaceToolStatus = internalAction({
  args: { grants: v.array(v.string()) },
  returns: v.any(),
  handler: (_ctx, args) => {
    if (args.grants.length === 0) {
      return Promise.resolve({
        tools: [],
        note: 'No workspace tools are granted to this agent.',
      });
    }
    return Promise.resolve({
      tools: args.grants.map((name) => ({
        name,
        description: TOOL_DESCRIPTIONS[name] ?? 'A platform workspace tool.',
        readOnly: true,
      })),
    });
  },
});
