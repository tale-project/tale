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
 * Every dispatch first re-resolves the turn user's access the way a user-side
 * `queryWithRLS` read would — active membership + the role matrix for the
 * table the tool exposes (`resolveWorkspaceReadAccess`) — so the session
 * token proves WHO the turn runs as, never that they may still read. V1 is
 * READ-ONLY (a write tool would need the approvals lane an async turn can't
 * answer), matching the connector bridge's stance.
 *
 * `'use node'` because knowledge search binds an embedder (filesystem/network).
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { searchKnowledge } from '../../knowledge/search';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import type { AgentReadSubject } from '../../lib/rls/helpers/agent_read_access';
import { ASK_HUMAN_TOOL } from '../../sandbox/tool_names';

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
    'passages with their text. Args: {query: string, limit?: number}.',
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
    /** The turn's user — absent on an automation run's token, whose only
     * grantable tool (`ask_human`) needs none. */
    userId: v.optional(v.string()),
    tool: v.string(),
    callArgs: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ToolResult> => {
    const result = await runWorkspaceTool(ctx, args);
    // Forensic trail: who/what/when/outcome + a sorted param-KEY fingerprint
    // (never values). Auditability is a bridge requirement; a logging failure
    // must not fail the call, so it's best-effort.
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
      })
      .catch((err: unknown) =>
        console.warn('[workspace-tools] audit write failed:', err),
      );
    return result;
  },
});

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

  // An external-turn token always carries the turn's user for the READ tools;
  // without one the read cannot be access-scoped, so it cannot run.
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
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    try {
      const result = await searchKnowledge(ctx, {
        organizationId: args.organizationId,
        orgSlug,
        query,
        limit,
      });
      return { status: 'ok', output: result };
    } catch (error) {
      // searchKnowledge REFUSES (throws) when the org has no embedding model
      // configured or its corpus is unusable — surface that as guidance, not
      // a transport error, so the agent tells the user instead of retrying.
      return {
        status: 'unavailable',
        blockers: [
          {
            code: 'knowledge_unavailable',
            guidance:
              'Knowledge search is not available for this organization ' +
              '(no embedding model configured, or the knowledge base is ' +
              'empty). Ask the user to set it up under Settings → Knowledge. ' +
              `(${error instanceof Error ? error.message : String(error)})`,
          },
        ],
      };
    }
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
