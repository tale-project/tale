import type { Sql } from 'postgres';

import type { AllowedModelRef } from '../../../lib/shared/providers/gateway_routing.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { workflowAgentBudgetCents } from '../../core/sandbox/agent_deadline.ts';
import { getSessionTokenByHash } from '../sandbox/sessions.ts';
import type { RelayUsage } from './usage.ts';

/**
 * What the relay reads and writes in Postgres (tale-project/tale#4942): the
 * grant a presented token carries, and the spend of the turn it serves.
 * Postgres and not this process holds both, so every backend replica — and
 * both colours during a deploy — admits and books a turn's calls against
 * one figure.
 */

/** What a token lets its holder call, and where its calls are booked. */
export interface RelayGrant {
  organizationId: string;
  sessionId: string;
  /** The turn's key: the op row its calls are admitted and booked on. */
  keyId: string;
  allowedModels: AllowedModelRef[];
  /** The credential each connector is served with, as the turn's mint
   * chose it; a connector absent here is served with its default. */
  servingCredentials: Readonly<Record<string, string>>;
}

function allowedModelsOf(value: unknown): AllowedModelRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { providerSlug, modelId, anthropicHarnessLane } = entry;
    if (typeof providerSlug !== 'string' || typeof modelId !== 'string') {
      return [];
    }
    return [
      {
        providerSlug,
        modelId,
        ...(anthropicHarnessLane === true
          ? { anthropicHarnessLane: true }
          : {}),
      },
    ];
  });
}

function credentialsOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * The grant of a live token (unrevoked, unexpired) by its hash, or null:
 * for a token that is not live, that names no key, or that may call no
 * model through the relay. The models are the scope's `relayModels`, which
 * a turn's mint writes for the relay (`allowedModels` names them as the
 * harness does, without the connector): a bridge-only token, such as a
 * subscription turn's, and a token the sandbox LLM gateway served carry
 * none.
 */
export async function grantOf(
  sql: Sql,
  tokenHash: string,
): Promise<RelayGrant | null> {
  const row = await getSessionTokenByHash(sql, tokenHash);
  if (row === null || row.llmGatewayKeyId === null) return null;
  const scope: Record<string, unknown> = isRecord(row.scope) ? row.scope : {};
  const allowedModels = allowedModelsOf(scope.relayModels);
  if (allowedModels.length === 0) return null;
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    keyId: row.llmGatewayKeyId,
    allowedModels,
    servingCredentials: credentialsOf(scope.servingCredentials),
  };
}

/**
 * What the turn behind a key may still spend, in cents: its allowance (the
 * op's `budget_cents`, else the deployment's default for an agent turn),
 * less the images it booked or holds, less what the relay booked. Null for
 * a key no op carries (a turn whose op is gone).
 */
export async function remainingCents(
  sql: Sql,
  keyId: string,
): Promise<number | null> {
  const rows = await sql<
    {
      budgetCents: number | null;
      imageSpentCents: number;
      imageHoldCents: number;
      relaySpentCents: number;
    }[]
  >`
    SELECT budget_cents::float8 AS "budgetCents",
           image_spent_cents::float8 AS "imageSpentCents",
           image_hold_cents::float8 AS "imageHoldCents",
           relay_spent_cents::float8 AS "relaySpentCents"
    FROM app.sandbox_session_ops
    WHERE minted_key_id = ${keyId}
    LIMIT 1
  `;
  const op = rows[0];
  if (op === undefined) return null;
  return (
    (op.budgetCents ?? workflowAgentBudgetCents()) -
    op.imageSpentCents -
    op.imageHoldCents -
    op.relaySpentCents
  );
}

/** Book one call on the turn behind its key: its cost and its counts, in
 * one statement, so concurrent calls of a turn never lose each other's. */
export async function bookCall(
  sql: Sql,
  keyId: string,
  usage: RelayUsage,
  costCents: number,
): Promise<void> {
  await sql`
    UPDATE app.sandbox_session_ops
    SET relay_spent_cents = relay_spent_cents + ${Math.max(0, costCents)},
        relay_input_tokens = relay_input_tokens + ${usage.inputTokens},
        relay_cache_read_tokens =
          relay_cache_read_tokens + ${usage.cacheReadTokens},
        relay_cache_write_tokens =
          relay_cache_write_tokens + ${usage.cacheWriteTokens},
        relay_output_tokens = relay_output_tokens + ${usage.outputTokens},
        relay_calls = relay_calls + 1
    WHERE minted_key_id = ${keyId}
  `;
}
