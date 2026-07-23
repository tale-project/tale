'use node';

/**
 * The capability surface, wired to the organization's real backends.
 *
 * `lib/chat/capabilities.ts` is the pure registry and dispatcher — one place
 * where a builtin tool, an integration action, an automation, a skill, and an
 * MCP tool are all "something with a name, a schema, and a result". This file
 * fills in the ports it leaves open:
 *
 *  - an integration action runs through the integrations dispatcher, as the
 *    calling user, so schema enforcement, approval gating, and the audit trail
 *    all apply — there is no second path to a connector;
 *  - an automation runs through the engine's `run_deployed` over the
 *    org-scoped automations store, so a chat-triggered run is the same act as
 *    any other run;
 *  - memory reads and writes go through the chat memory functions, so a
 *    proposed memory lands pending and only approved rows are ever returned.
 *
 * Knowledge retrieval stays a clean, unfilled port: the retrieval pipeline is
 * owned by another lane, and `get_knowledge` answers `unavailable` with a
 * reason rather than an empty result — "the knowledge base cannot be searched"
 * and "nothing was found" are different facts, and conflating them teaches the
 * model to stop asking.
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
  type MemoryStore,
} from '../../lib/chat';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { automationActionStore } from '../automations/store';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

interface SurfaceScope {
  readonly organizationId: string;
  readonly userId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** An integration action, run through the integrations dispatcher as the
 * calling user. Delegating to `runIntegrationAction` reuses the dispatcher's
 * own live host — credential resolution, approval gating, and the audit sink —
 * instead of rebuilding it. */
async function runIntegration(
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
      internal.integrations.execute_action.runIntegrationAction,
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
    hint: 'Use an automation or an integration action instead.',
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
    integration: (request) =>
      runIntegration(ctx, {
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

/**
 * Assemble the org-scoped capability surface with its real backends. The
 * knowledge port is left absent, so `get_knowledge` answers `unavailable` with
 * a reason.
 */
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
    memory: buildMemoryStore(ctx),
    audit: buildAuditSink(ctx),
  });
}

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
