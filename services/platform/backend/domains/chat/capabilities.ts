import type { Sql } from 'postgres';

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
} from '../../../lib/chat/index.ts';
import type { KnowledgeCorpus } from '../../../lib/knowledge/types.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { pgAutomationStore } from '../automations/dispatch-store.ts';
import { runConnectorAction } from '../connectors/service.ts';
import { searchKnowledgeForOrg } from '../knowledge/service.ts';
import { saveMemory, searchApprovedMemories } from './memories.ts';

/**
 * The org-scoped capability surface on 0.5 backends — the 0.4
 * `chat/capabilities_action` twin. The pure registry/dispatcher
 * (`lib/chat`) stays whole; this fills its ports: connector actions run
 * through the inc-52 door (credential resolution, approval gating, audit —
 * no second path), automations run through the pg `DispatchStore` (a
 * chat/MCP-triggered run is the same act as any other run), memory
 * writes land pending, knowledge retrieval goes through the one search
 * entry point and answers `unavailable`-with-reason rather than an empty
 * list when it cannot run.
 */

export class CapabilityAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CapabilityAuthError';
    this.code = code;
  }
}

interface SurfaceScope {
  readonly organizationId: string;
  readonly userId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function runConnector(
  sql: Sql,
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
    const result = await runConnectorAction(sql, {
      organizationId: request.organizationId,
      connector: request.connector,
      action: request.action,
      input: request.input,
      ...(request.credentialRef !== undefined
        ? { credentialRef: request.credentialRef }
        : {}),
      mode: 'live',
      caller: { kind: 'user', userId: request.userId },
    });
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
    // The dispatcher raises coded refusals (AppError-shaped `data`, or
    // the 0.5 domain errors carrying `code`); surface message + hint as
    // data so the caller's model can read and act on them. Anything
    // uncoded is an infrastructure failure and re-throws.
    if (error !== null && typeof error === 'object' && 'data' in error) {
      const data: unknown = error.data;
      const reason =
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : 'The action failed.';
      const hint =
        isRecord(data) && typeof data.hint === 'string' ? data.hint : undefined;
      return {
        status: 'refused',
        reason,
        ...(hint !== undefined ? { hint } : {}),
      };
    }
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return { status: 'refused', reason: error.message };
    }
    throw error;
  }
}

function unavailableBackend(kind: string): () => Promise<BackendResult> {
  return async () => ({
    status: 'refused',
    reason: `${kind} capabilities are not available on this deployment yet.`,
    hint: 'Use an automation or a connector action instead.',
  });
}

function buildBackends(sql: Sql, scope: SurfaceScope): CapabilityBackends {
  const automation = createAutomationsBackend({
    store: pgAutomationStore(sql, {
      organizationId: scope.organizationId,
      actor: scope.userId,
    }),
    allowLive: true,
  });
  return {
    builtin: unavailableBackend('Builtin'),
    connector: (request) =>
      runConnector(sql, {
        organizationId: request.organizationId,
        userId: request.userId,
        connector: request.connector,
        action: request.action,
        input: request.input,
        ...(request.credentialRef !== undefined
          ? { credentialRef: request.credentialRef }
          : {}),
      }),
    skill: unavailableBackend('Skill'),
    automation,
    mcp: unavailableBackend('MCP tool'),
  };
}

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

function buildKnowledgeBackend(sql: Sql): KnowledgeBackend {
  return {
    async search(request) {
      try {
        // Deliberately NO access scope (the 0.4 posture for this lane): an
        // organization API key already speaks for the whole org.
        const result = await searchKnowledgeForOrg(sql, {
          organizationId: request.organizationId,
          query: request.query,
          corpus: toKnowledgeCorpus(request.corpus),
          ...(request.limit !== undefined ? { limit: request.limit } : {}),
        });
        const passages: KnowledgePassage[] = [];
        for (const hit of result.hits) {
          const passage: KnowledgePassage = {
            text: hit.text,
            source: hit.source.title ?? hit.source.ref,
            ref: hit.source.ref,
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
        console.warn('[chat] knowledge retrieval refused', reason);
        return {
          status: 'unavailable',
          reason: `The knowledge base could not be searched: ${reason} Do not treat this as "nothing found".`,
        };
      }
    },
  };
}

function buildMemoryStore(sql: Sql): MemoryStore {
  return {
    async save(request) {
      const id = await saveMemory(sql, {
        organizationId: request.organizationId,
        userId: request.userId,
        content: request.content,
        ...(request.sourceThreadId !== undefined
          ? { sourceThreadId: request.sourceThreadId }
          : {}),
        ...(request.sourceMessageId !== undefined
          ? { sourceMessageId: request.sourceMessageId }
          : {}),
      });
      return { id };
    },
    async search(request) {
      return searchApprovedMemories(sql, {
        organizationId: request.organizationId,
        userId: request.userId,
        ...(request.query !== undefined ? { query: request.query } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      });
    },
  };
}

function buildAuditSink(sql: Sql): CapabilityAuditSink {
  return {
    async record(entry) {
      await sql.begin((tx) =>
        createAuditLog(tx, {
          organizationId: entry.organizationId,
          actorId: entry.userId,
          actorType: 'user',
          action: entry.action,
          category: 'ai',
          resourceType: 'chat_memory',
          resourceId: entry.memoryId,
          status: 'success',
          ...(entry.threadId ? { metadata: { threadId: entry.threadId } } : {}),
        }),
      );
    },
  };
}

/** Deployed automations as invocable capabilities — best-effort (the 0.4
 * posture: a store read failure leaves them out, never fails the surface). */
async function registerAutomations(
  sql: Sql,
  registry: CapabilityRegistry,
  scope: SurfaceScope,
): Promise<void> {
  try {
    const store = pgAutomationStore(sql, {
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

/** Assemble the org-scoped capability surface with its 0.5 backends. */
export async function buildCapabilitySurface(
  sql: Sql,
  scope: SurfaceScope,
): Promise<CapabilitySurface> {
  const registry = new CapabilityRegistry(scope.organizationId);
  await registerAutomations(sql, registry, scope);
  return createCapabilitySurface({
    organizationId: scope.organizationId,
    userId: scope.userId,
    registry,
    backends: buildBackends(sql, scope),
    knowledge: buildKnowledgeBackend(sql),
    memory: buildMemoryStore(sql),
    audit: buildAuditSink(sql),
  });
}

/**
 * The capability dispatch for a caller proved elsewhere (the platform MCP
 * endpoint): the membership is re-checked from the (organization, user)
 * pair before anything runs — the 0.4 `dispatchCapabilityAs`.
 */
export async function dispatchCapabilityAs(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    method: string;
    params?: unknown;
  },
): Promise<unknown> {
  const rows = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${args.organizationId}
      AND "userId" = ${args.userId}
    LIMIT 1
  `;
  const role = rows[0]?.role;
  if (role === undefined || role === 'disabled') {
    throw new CapabilityAuthError(
      'ORG_FORBIDDEN',
      'The caller is not a member of this organization.',
    );
  }
  const surface = await buildCapabilitySurface(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
  });
  return surface.dispatch(args.method, args.params ?? {});
}
