'use node';

/**
 * The capability surface, wired to the organization's real backends.
 *
 * `lib/chat/capabilities.ts` is the pure registry and dispatcher — one place
 * where a builtin tool, an connector action, an automation, a skill, and an
 * MCP tool are all "something with a name, a schema, and a result". This file
 * fills in the ports it leaves open:
 *
 *  - an connector action runs through the connectors dispatcher, as the
 *    calling user, so schema enforcement, approval gating, and the audit trail
 *    all apply — there is no second path to a connector;
 *  - an automation runs through the engine's `run_deployed` over the
 *    org-scoped automations store, so a chat-triggered run is the same act as
 *    any other run;
 *  - memory reads and writes go through the chat memory functions, so a
 *    proposed memory lands pending and only approved rows are ever returned;
 *  - knowledge retrieval goes through `searchKnowledge`, the one entry point
 *    into the retrieval pipeline, resolved per organization.
 *
 * A knowledge search that CANNOT run answers `unavailable` with a reason rather
 * than an empty result — "the knowledge base cannot be searched" and "nothing
 * was found" are different facts, and conflating them teaches the model to stop
 * asking. An organization with no embedding model configured is exactly that
 * case: the pipeline refuses, and the refusal is passed on as an answer instead
 * of failing the tool call.
 *
 * Builtin, skill, and MCP kinds have no backend on this deployment yet; they
 * refuse with a reason rather than pretending to run, so a registered
 * capability of those kinds is honest about what it cannot do.
 */

import { ConvexError, v } from 'convex/values';

import {
  CapabilityRegistry,
  createAutomationsBackend,
  createCapabilitySurface,
  type BackendResult,
  type CapabilityAuditSink,
  type CapabilityBackends,
  type CapabilitySurface,
  type KnowledgeBackend,
  type KnowledgePassage,
  type MemoryStore,
} from '../../lib/chat';
import type { KnowledgeCorpus } from '../../lib/knowledge/types';
import { internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { automationActionStore } from '../automations/store';
import { searchKnowledge } from '../knowledge/search';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

interface SurfaceScope {
  readonly organizationId: string;
  readonly userId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An connector action, run through the connectors dispatcher as the
 * calling user. Delegating to `runConnectorAction` reuses the dispatcher's
 * own live host — credential resolution, approval gating, and the audit sink —
 * instead of rebuilding it. */
async function runConnector(
  ctx: ActionCtx,
  request: {
    organizationId: string;
    userId: string;
    connector: string;
    action: string;
    input: unknown;
    credentialRef?: string;
  },
): Promise<BackendResult> {
  try {
    const result = await ctx.runAction(
      internal.connectors.execute_action.runConnectorAction,
      {
        organizationId: request.organizationId,
        connector: request.connector,
        action: request.action,
        input: request.input,
        ...(request.credentialRef !== undefined && {
          credentialRef: request.credentialRef,
        }),
        mode: 'live',
        caller: { kind: 'user', userId: request.userId },
      },
    );
    if (
      result !== null &&
      typeof result === 'object' &&
      'status' in result &&
      result.status === 'approval-required'
    ) {
      const message =
        'message' in result && typeof result.message === 'string'
          ? result.message
          : 'This action requires approval.';
      return {
        status: 'refused',
        reason: message,
        hint: 'The organization requires a human to approve this action. Tell the user it is waiting for approval.',
      };
    }
    const output =
      result !== null && typeof result === 'object' && 'output' in result
        ? result.output
        : result;
    return { status: 'ok', output };
  } catch (error) {
    // The dispatcher raises a coded refusal for a rejected or misconfigured
    // action; surface its message and hint so the model can act on it.
    if (error instanceof ConvexError) {
      const data: unknown = error.data;
      const reason =
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : 'The action failed.';
      const hint =
        isRecord(data) && typeof data.hint === 'string' ? data.hint : undefined;
      return { status: 'refused', reason, hint };
    }
    throw error;
  }
}

/** Kinds with no backend on this deployment refuse with a reason rather than
 * pretending to run. */
function unavailableBackend(kind: string): () => Promise<BackendResult> {
  return async () => ({
    status: 'refused',
    reason: `${kind} capabilities are not available on this deployment yet.`,
    hint: 'Use an automation or an connector action instead.',
  });
}

function buildBackends(
  ctx: ActionCtx,
  scope: SurfaceScope,
): CapabilityBackends {
  const automation = createAutomationsBackend({
    store: automationActionStore(ctx, {
      organizationId: scope.organizationId,
      actor: scope.userId,
    }),
    allowLive: true,
  });

  return {
    builtin: unavailableBackend('Builtin'),
    connector: (request) =>
      runConnector(ctx, {
        organizationId: request.organizationId,
        userId: request.userId,
        connector: request.connector,
        action: request.action,
        input: request.input,
        credentialRef: request.credentialRef,
      }),
    skill: unavailableBackend('Skill'),
    automation,
    mcp: unavailableBackend('MCP tool'),
  };
}

/** The chat surface's corpus names, in the retrieval pipeline's own vocabulary.
 * `private` is the organization's documents, `public-web` its crawled pages. */
function toKnowledgeCorpus(
  corpus: 'private' | 'public-web' | 'all' | undefined,
): KnowledgeCorpus {
  switch (corpus) {
    case 'private':
      return 'documents';
    case 'public-web':
      return 'web';
    default:
      return 'all';
  }
}

/**
 * Knowledge retrieval, bound to the organization.
 *
 * The slug is resolved lazily, inside the search: it addresses the corpus while
 * the id addresses the embedding credential, and a turn that never retrieves
 * should not pay for the lookup.
 *
 * A refusal from the pipeline — no embedding model configured, a bring-your-own
 * database that cannot be reached — comes back as `unavailable` WITH the reason,
 * never as an empty passage list and never as a thrown tool call: the caller has
 * to be able to tell "cannot search" from "found nothing".
 */
function buildKnowledgeBackend(ctx: ActionCtx): KnowledgeBackend {
  return {
    async search(request) {
      try {
        const orgSlug = await resolveOrgSlug(ctx, request.organizationId);
        const result = await searchKnowledge(ctx, {
          organizationId: request.organizationId,
          orgSlug,
          query: request.query,
          corpus: toKnowledgeCorpus(request.corpus),
          ...(request.limit !== undefined && { limit: request.limit }),
        });
        const passages: KnowledgePassage[] = [];
        for (const hit of result.hits) {
          const passage: KnowledgePassage = {
            text: hit.text,
            // A document cites by title, a web page by URL; either way the
            // caller gets something a person can look up.
            source: hit.source.title ?? hit.source.ref,
            score: hit.fusedScore,
          };
          if (hit.source.url !== undefined && hit.source.url !== null) {
            passages.push({ ...passage, url: hit.source.url });
          } else {
            passages.push(passage);
          }
        }
        return { status: 'ok', passages };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          '[chat] knowledge retrieval refused',
          error instanceof Error ? error.message : error,
        );
        return {
          status: 'unavailable',
          reason: `The knowledge base could not be searched: ${reason} Do not treat this as "nothing found".`,
        };
      }
    },
  };
}

function buildMemoryStore(ctx: ActionCtx): MemoryStore {
  return {
    async save(request) {
      const { id } = await ctx.runMutation(
        internal.chat.memories.saveMemoryInternal,
        {
          organizationId: request.organizationId,
          userId: request.userId,
          content: request.content,
          sourceThreadId: request.sourceThreadId,
          sourceMessageId: request.sourceMessageId,
        },
      );
      return { id };
    },
    async search(request) {
      return ctx.runQuery(
        internal.chat.memories.searchApprovedMemoriesInternal,
        {
          organizationId: request.organizationId,
          userId: request.userId,
          query: request.query,
          limit: request.limit,
        },
      );
    },
  };
}

function buildAuditSink(ctx: ActionCtx): CapabilityAuditSink {
  return {
    async record(entry) {
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
          organizationId: entry.organizationId,
          actorId: entry.userId,
          actorType: 'user',
          action: entry.action,
          category: 'ai',
          resourceType: 'chat_memory',
          resourceId: entry.memoryId,
          status: 'success',
          ...(entry.threadId ? { metadata: { threadId: entry.threadId } } : {}),
        },
      );
    },
  };
}

/** Register the organization's deployed automations as invocable capabilities.
 * Best-effort: a failure to read the automations store leaves the registry
 * without them rather than failing the whole surface, and an automation with
 * no deployed version simply refuses at invocation with the engine's own
 * reason. */
async function registerAutomations(
  ctx: ActionCtx,
  registry: CapabilityRegistry,
  scope: SurfaceScope,
): Promise<void> {
  try {
    const store = automationActionStore(ctx, {
      organizationId: scope.organizationId,
      actor: scope.userId,
    });
    for (const item of await store.list()) {
      registry.register({
        kind: 'automation',
        id: `automation.${item.name}`,
        name: item.name,
        description: `Run the "${item.name}" automation.`,
        inputSchema: { type: 'object' },
        automation: item.name,
        eventOnly: false,
      });
    }
  } catch (error) {
    console.warn(
      '[chat] could not list automations for the capability registry',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Assemble the org-scoped capability surface with its real backends. */
export async function buildChatCapabilitySurface(
  ctx: ActionCtx,
  scope: SurfaceScope,
): Promise<CapabilitySurface> {
  const registry = new CapabilityRegistry(scope.organizationId);
  await registerAutomations(ctx, registry, scope);

  return createCapabilitySurface({
    organizationId: scope.organizationId,
    userId: scope.userId,
    registry,
    backends: buildBackends(ctx, scope),
    knowledge: buildKnowledgeBackend(ctx),
    memory: buildMemoryStore(ctx),
    audit: buildAuditSink(ctx),
  });
}

/**
 * The org's capability catalog, exactly as the turn pipeline registers it —
 * the ids an agent's `tools` allowlist narrows. A catalog UI (the agent
 * editor's Tools tab) lists THIS rather than a hand-written copy, so the
 * choices on screen are precisely what a turn can reach; new capability
 * kinds appear here the moment their registration lands, with no UI change.
 */
export const listCapabilities = action({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      kind: v.string(),
      name: v.string(),
      description: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ id: string; kind: string; name: string; description: string }>
  > => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const registry = new CapabilityRegistry(args.organizationId);
    await registerAutomations(ctx, registry, {
      organizationId: args.organizationId,
      userId: auth.userId,
    });
    return registry.list().map((capability) => ({
      id: capability.id,
      kind: capability.kind,
      name: capability.name,
      description: capability.description,
    }));
  },
});

/**
 * The one entry point the JSON-RPC and MCP faces call. Authenticates the
 * caller, builds the surface for their organization, and dispatches the
 * method. The return type is annotated explicitly: a capability result is
 * unknown by design, and letting that flow unannotated into the generated API
 * would degrade the chat API's types.
 */
export const dispatchCapability = action({
  args: {
    organizationId: v.string(),
    method: v.string(),
    params: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const surface = await buildChatCapabilitySurface(ctx, {
      organizationId: args.organizationId,
      userId: auth.userId,
    });
    return surface.dispatch(args.method, args.params ?? {});
  },
});

/**
 * The same dispatch, for a caller whose identity was proved somewhere else — the
 * platform MCP endpoint, which authenticates an organization API key and resolves
 * the organization from the key holder's own memberships before it gets here.
 *
 * There is no Convex auth identity on that path, so the user is named explicitly
 * and the membership is re-checked from the (organization, user) pair: an
 * internal function is unreachable from a client, but a surface that acts AS a
 * person must still prove that person belongs to the organization it acts in.
 */
export const dispatchCapabilityAs = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    method: v.string(),
    params: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMemberRole,
      { userId: args.userId, organizationId: args.organizationId },
    );
    if (role === null || role === 'disabled') {
      // Same answer for "no such organization" and "not your organization".
      throw new ConvexError({
        code: 'ORG_FORBIDDEN',
        message: 'The caller is not a member of this organization.',
      });
    }
    const surface = await buildChatCapabilitySurface(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
    });
    return surface.dispatch(args.method, args.params ?? {});
  },
});
