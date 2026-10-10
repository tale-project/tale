/**
 * Native backend for the `knowledge` platform connector — the organization's
 * knowledge search as an automation step: the passages that match a query
 * best, from its documents, its indexed web pages, or both.
 *
 * It searches AS THE RUN. What the run may read (its project's documents,
 * its automation's bound projects', or only the hub's) and whose spend the
 * query's embedding is (the run's subject, as an llm step's call) are
 * decided by the platform from the run itself — `caller.runId` — never by
 * the step's input. A caller that is not an automation run's step has no run
 * to search as, and is refused.
 */

import { z } from 'zod';

import type { FailureCause } from '../../engine/core/record/failure';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError, type ConnectorErrorCode } from '../errors';

/** One passage the search found, as a step reads it. */
export interface KnowledgeRunHit {
  /** The passage, with its document's contextual header. */
  text: string;
  title: string | null;
  /** Which corpus it came from. */
  source: 'documents' | 'web';
  /** The document record a documents passage belongs to, when one holds it. */
  documentId?: string;
  /** The project the document is filed under; absent for a hub document. */
  projectId?: string;
  /** The page a web passage came from. */
  url?: string;
  /** The rank it was ordered by, higher first. */
  score: number;
  /** How close the passage's meaning is to the query (cosine, -1 to 1), when
   * the semantic leg found it. */
  similarity?: number;
}

/** Why a search did not run. */
export type KnowledgeRunRefusal =
  | { kind: 'not_configured' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'budget'; detail: string }
  /** The run is gone, or pinned to a project whose row is gone. */
  | { kind: 'no_scope' };

/** What the rim needs from the platform's knowledge domain. */
export interface WorkflowKnowledgeSearch {
  search(args: {
    organizationId: string;
    runId: string;
    query: string;
    corpus: 'documents' | 'web' | 'all';
    limit: number;
    folder?: string;
  }): Promise<
    | { ok: true; hits: KnowledgeRunHit[] }
    | { ok: false; refusal: KnowledgeRunRefusal }
  >;
}

const searchInput = z
  .object({
    query: z.string().min(1).max(2000),
    limit: z.number().int().min(1).max(20).default(5),
    corpus: z.enum(['documents', 'web', 'all']).default('all'),
    folder: z.string().min(1).max(1024).optional(),
  })
  .strict();

/** A refusal that knows its cause in the run record's words. */
class KnowledgeRefusal extends ConnectorError {
  readonly failure: FailureCause;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    failure: FailureCause,
    hint: string,
  ) {
    super(code, message, { connector: 'knowledge', action: 'search', hint });
    this.failure = failure;
  }
}

function refused(refusal: KnowledgeRunRefusal): ConnectorError {
  if (refusal.kind === 'not_configured') {
    return new KnowledgeRefusal(
      'LIVE_BODY_FAILED',
      'No embedding model is configured for this organization',
      { reason: 'KNOWLEDGE_NOT_CONFIGURED', params: {} },
      'an administrator chooses one in Settings › Data residency',
    );
  }
  if (refusal.kind === 'unavailable') {
    return new KnowledgeRefusal(
      'LIVE_BODY_FAILED',
      `The knowledge search failed: ${refusal.detail}`,
      { reason: 'KNOWLEDGE_UNAVAILABLE', params: { detail: refusal.detail } },
      'run again; if it repeats, check the embedding model',
    );
  }
  if (refusal.kind === 'budget') {
    return new KnowledgeRefusal(
      'LIVE_BODY_FAILED',
      `The knowledge search was refused: ${refusal.detail}`,
      { reason: 'BUDGET_EXCEEDED', params: { detail: refusal.detail } },
      'wait until the limit resets, or ask an administrator to raise it',
    );
  }
  return new ConnectorError(
    'LIVE_BODY_FAILED',
    'The run no longer exists, or its project was deleted, so there is nothing it may search',
    { connector: 'knowledge', action: 'search' },
  );
}

/** The run a call searches as: only an automation run's step has one. */
function runIdOf(ctx: NativeConnectorContext): string {
  if (ctx.caller?.kind !== 'workflow') {
    throw new ConnectorError(
      'CALLER_UNKNOWN',
      'knowledge.search searches as an automation run, and this call is not a step of one',
      { connector: 'knowledge', action: 'search' },
    );
  }
  return ctx.caller.runId;
}

export function knowledgeNatives(
  store: WorkflowKnowledgeSearch,
): Record<'knowledge.search', NativeConnectorImpl> {
  return {
    'knowledge.search': async (raw, ctx) => {
      const parsed = searchInput.safeParse(raw);
      if (!parsed.success) {
        throw new ConnectorError(
          'INPUT_INVALID',
          `knowledge.search input is invalid: ${parsed.error.issues
            .map(
              (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
            )
            .join('; ')}`,
          { connector: 'knowledge', action: 'search' },
        );
      }
      const input = parsed.data;
      const answer = await store.search({
        organizationId: ctx.organizationId,
        runId: runIdOf(ctx),
        query: input.query,
        corpus: input.corpus,
        limit: input.limit,
        ...(input.folder !== undefined && { folder: input.folder }),
      });
      if (!answer.ok) throw refused(answer.refusal);
      return { hits: answer.hits };
    },
  };
}
