'use node';

/**
 * Server side of the in-sandbox WORKSPACE-TOOL bridge
 * (`tale-integrations-mcp` `workspace_tool`/`workspace_status` →
 * `/api/tools/{execute,status}`). The first-party counterpart of
 * `integrations_bridge.ts`: where that surface reaches the org's third-party
 * connectors, this one reaches the org's OWN platform data — knowledge and the
 * Documents hub — as read-only tools.
 *
 * Same discipline as the integration surface: whatever these actions return is
 * relayed verbatim to the coding agent as the tool result, so every shape is
 * written FOR THE MODEL (structured status + guidance, never a bare throw). The
 * reads run as the turn's user, org-scoped, through the same access-controlled
 * internal queries the rest of the platform uses — nothing here widens a
 * boundary. V1 is READ-ONLY (a write tool would need the approvals lane an
 * async turn can't answer), matching the integration bridge's stance.
 *
 * `'use node'` because knowledge search binds an embedder (filesystem/network).
 */

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { searchKnowledge } from '../../knowledge/search';
import { orgSlugFromId } from '../../lib/helpers/org_slug';

/**
 * The read-only workspace tools a managed coding turn is granted by default.
 * These are first-party reads of the ORG's own data — org-scoped and audited —
 * so a default read grant is honest without a per-agent picker (the agent
 * Tools-tab UI was retired). The names match the descriptions baked into the
 * shipped `tale-integrations-mcp` shim, so the model's tool guidance is
 * accurate. A write tool is deliberately absent in V1.
 */
export const WORKSPACE_READ_TOOLS = [
  'rag_search',
  'document_find',
  'contact_find',
  'product_find',
  'website_find',
] as const;

/** Human-facing one-liners the status listing relays to the model. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  rag_search:
    "Search the organization's knowledge base; returns the most relevant " +
    'passages with their text. Args: {query: string, limit?: number}.',
  document_find:
    'List/browse documents in the organization Documents hub this user can ' +
    'access. Args: {fileName?: string, extension?: string, limit?: number}.',
  contact_find:
    "Search/list the organization's contacts (CRM). " +
    'Args: {searchTerm?: string, limit?: number}.',
  product_find:
    "List the organization's products/catalog. Args: {limit?: number}.",
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

/**
 * Run one read-only workspace tool for a sandbox coding turn. The HTTP dispatch
 * has already authenticated the session token and checked the grant set; this
 * action owns tool-name validation and the org-scoped read as the turn's user.
 */
export const dispatchWorkspaceTool = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    userId: v.string(),
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
    userId: string;
    tool: string;
    callArgs: unknown;
  },
): Promise<ToolResult> {
  const callArgs = isRecord(args.callArgs) ? args.callArgs : {};

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
        userId: args.userId,
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

  // The org data domains — all org-scoped internal reads (never a per-user or
  // cross-org leak), paginated where the underlying query is.
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
          cursor: null,
        },
      },
    );
    return { status: 'ok', output: page };
  }

  if (args.tool === 'product_find') {
    const page = await ctx.runQuery(
      internal.products.internal_queries.listByOrganization,
      {
        organizationId: args.organizationId,
        paginationOpts: {
          numItems: readLimit(callArgs.limit, 50),
          cursor: null,
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

  return {
    status: 'invalid_args',
    message:
      `Unknown workspace tool "${args.tool}". ` +
      `Available: ${WORKSPACE_READ_TOOLS.join(', ')}. Call workspace_status to see what is granted.`,
  };
}

/** A caller-supplied `limit`, floored to a positive int and capped. */
function readLimit(raw: unknown, cap: number): number {
  return typeof raw === 'number' && raw > 0
    ? Math.min(Math.floor(raw), cap)
    : Math.min(20, cap);
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
