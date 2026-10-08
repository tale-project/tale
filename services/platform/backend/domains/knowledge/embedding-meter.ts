import type { Sql } from 'postgres';

import type {
  EmbeddingBudgetExceeded,
  EmbeddingMeter,
} from '../../core/knowledge/embedding.ts';
import type { BudgetViolation } from '../governance/budget-gate.ts';
import {
  directCallBlocked,
  type DirectCallSubject,
  isDirectCallLease,
  openTokenCall,
  releaseDirectCall,
  settleTokenCall,
} from '../governance/direct-calls.ts';

/** The longest one embedding request may hold its worst case: a batch's
 * own ceiling (15 minutes), with room to spare. */
const EMBEDDING_CALL_MAX_MS = 20 * 60 * 1000;

/** The tokens one embedding request is reckoned to need before the work's
 * first request is known: one chunk of Tale's size, which `embedding.ts`
 * puts at 700–1,000 tokens. */
const ONE_CHUNK_TOKENS = 1_024;

/**
 * Whether embedding work for `subject` would be refused at its first
 * request: the hold every embedding request takes — at least a cent, and a
 * chunk's tokens — measured against the caps that bind the subject, holding
 * nothing (`directCallBlocked`). The early answer for indexing that waits on
 * a limit: a file, an email or a website is not read again only to be
 * refused, as it would be while a cap keeps less than a cent of room —
 * where requests costing a fraction of a cent leave it.
 */
export function embeddingBlocked(
  sql: Sql,
  args: { organizationId: string; subject: DirectCallSubject },
): Promise<BudgetViolation | null> {
  return directCallBlocked(sql, {
    ...args,
    worstCase: { cents: 1, tokens: ONE_CHUNK_TOKENS },
  });
}

/**
 * The meter an embedder's requests are held and booked through, as the
 * spend of `subject` — the uploader of a file, the member searching, nobody
 * (`__automation__`) for an inbound mail or a scheduled re-crawl: each
 * request is a token-priced direct call (`governance/direct-calls.ts`)
 * whose worst case is its estimated input at the model's catalog price,
 * booked under `__embedding__` at what the provider reported.
 */
export function embeddingMeter(
  sql: Sql,
  args: { organizationId: string; subject: DirectCallSubject },
): EmbeddingMeter {
  return {
    async open(request) {
      const admission = await openTokenCall(sql, {
        organizationId: args.organizationId,
        provider: request.provider,
        model: request.model,
        lane: 'embedding',
        subject: args.subject,
        promptTokens: request.tokens,
        maxOutputTokens: 0,
        maxDurationMs: EMBEDDING_CALL_MAX_MS,
      });
      if (admission.allowed) return { lease: admission.lease };
      return {
        refused: admission.reason,
        ...(admission.violation !== undefined
          ? {
              retryAtMs: admission.violation.resetsAt,
              detail: admission.violation,
            }
          : {}),
      };
    },
    async settle(lease, usage) {
      if (!isDirectCallLease(lease)) return;
      await settleTokenCall(sql, lease, {
        organizationId: args.organizationId,
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.tokens,
        outputTokens: 0,
      });
    },
    async release(lease) {
      if (!isDirectCallLease(lease)) return;
      await releaseDirectCall(sql, lease);
    },
  };
}

/**
 * A meter whose subject is read on its first request — for a door that
 * dispatches many tools and should learn whose spend a search is only when
 * one runs.
 */
export function deferredEmbeddingMeter(
  sql: Sql,
  args: {
    organizationId: string;
    subject: () => Promise<DirectCallSubject>;
  },
): EmbeddingMeter {
  let meter: Promise<EmbeddingMeter> | undefined;
  const resolved = (): Promise<EmbeddingMeter> => {
    meter ??= args
      .subject()
      .then((subject) =>
        embeddingMeter(sql, { organizationId: args.organizationId, subject }),
      );
    return meter;
  };
  return {
    open: async (request) => (await resolved()).open(request),
    settle: async (lease, usage) => (await resolved()).settle(lease, usage),
    release: async (lease) => (await resolved()).release(lease),
  };
}

const VIOLATION_SCOPES: readonly BudgetViolation['scope'][] = [
  'user',
  'team',
  'org',
  'apiKey',
  'project',
];
const VIOLATION_CODES: readonly BudgetViolation['code'][] = [
  'TOKEN_LIMIT',
  'COST_LIMIT',
  'REQUEST_LIMIT',
];
const VIOLATION_PERIODS: readonly BudgetViolation['period'][] = [
  'daily',
  'weekly',
  'monthly',
];

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return values.some((candidate) => candidate === value);
}

/** The cap that refused an embedding request this meter opened, read back
 * off the refusal; null when the refusal carries none. */
export function refusedEmbeddingCap(
  error: EmbeddingBudgetExceeded,
): BudgetViolation | null {
  const detail: unknown = error.detail;
  if (typeof detail !== 'object' || detail === null) return null;
  const scope: unknown = Reflect.get(detail, 'scope');
  const code: unknown = Reflect.get(detail, 'code');
  const period: unknown = Reflect.get(detail, 'period');
  const used: unknown = Reflect.get(detail, 'used');
  const limit: unknown = Reflect.get(detail, 'limit');
  const reason: unknown = Reflect.get(detail, 'reason');
  const resetsAt: unknown = Reflect.get(detail, 'resetsAt');
  const teamId: unknown = Reflect.get(detail, 'teamId');
  const projectId: unknown = Reflect.get(detail, 'projectId');
  if (
    !isOneOf(VIOLATION_SCOPES, scope) ||
    !isOneOf(VIOLATION_CODES, code) ||
    !isOneOf(VIOLATION_PERIODS, period) ||
    typeof used !== 'number' ||
    typeof limit !== 'number' ||
    typeof resetsAt !== 'number'
  ) {
    return null;
  }
  return {
    scope,
    code,
    period,
    used,
    limit,
    reason: typeof reason === 'string' ? reason : error.message,
    resetsAt,
    ...(typeof teamId === 'string' ? { teamId } : {}),
    ...(typeof projectId === 'string' ? { projectId } : {}),
  };
}
