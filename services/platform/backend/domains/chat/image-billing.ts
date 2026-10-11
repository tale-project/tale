import type { Sql } from 'postgres';

import { CHAT_ASSISTANT_SLUG } from '../../../lib/chat/assistant.ts';
import { SANDBOX_IMAGE_HOLD_CENTS } from '../../core/sandbox/session_constants.ts';
import type { ImageBilling } from '../agent_tools/scope.ts';
import {
  budgetPolicyActive,
  findBudgetViolation,
  loadBudgetSubject,
} from '../governance/budget-gate.ts';
import { budgetRefusalMessage } from '../governance/budget-refusal.ts';
import {
  lockBudgetAdmission,
  readInFlightReservations,
} from '../governance/budget-reservations.ts';
import { incrementUsageLedger } from '../governance/service.ts';

/**
 * How a chat turn's images are admitted and booked: as part of the turn.
 *
 * The turn's generation row already carries its hold — what its model
 * rounds may still spend — which every budget admission of the organization
 * counts. An image raises that hold by its estimate before the provider is
 * called, measured against every cap that binds the person (their own,
 * their teams', the chat's project's, the organization's, an API key's)
 * beside everything else in flight, this turn's own hold included. The
 * settle books each billed request in the usage ledger under the person,
 * on the chat's project too, and lowers the hold again — in one
 * transaction, so the spend never counts as neither.
 *
 * With no budget policy on, nothing binds and nothing is held; the spend is
 * still booked.
 */

/** Images one chat turn may create — the ceiling a managed agent turn has. */
export const CHAT_TURN_MAX_GENERATED_IMAGES = 16;

export function chatImageBilling(
  sql: Sql,
  turn: {
    organizationId: string;
    userId: string;
    apiKeyId?: string;
    threadId: string;
    projectIds: readonly string[];
  },
): ImageBilling {
  let admitted = 0;
  return {
    async admit(images) {
      if (admitted + images > CHAT_TURN_MAX_GENERATED_IMAGES) {
        const left = CHAT_TURN_MAX_GENERATED_IMAGES - admitted;
        return {
          admitted: false,
          message:
            left <= 0
              ? `This reply has created the ${CHAT_TURN_MAX_GENERATED_IMAGES} images one reply may create.`
              : `This reply may create ${left} more ${left === 1 ? 'image' : 'images'}, not ${images}.`,
        };
      }
      const holdCents = images * SANDBOX_IMAGE_HOLD_CENTS;
      if (!(await budgetPolicyActive(sql, turn.organizationId))) {
        admitted += images;
        return { admitted: true, holdCents: 0 };
      }
      const verdict = await sql.begin(async (tx) => {
        await lockBudgetAdmission(tx, turn.organizationId);
        const subject = await loadBudgetSubject(tx, {
          organizationId: turn.organizationId,
          userId: turn.userId,
          ...(turn.apiKeyId !== undefined ? { apiKeyId: turn.apiKeyId } : {}),
          projectIds: turn.projectIds,
        });
        const violation = await findBudgetViolation(tx, subject, {
          reservations: await readInFlightReservations(tx, subject),
          prospectiveCostCents: holdCents,
          // The gate refuses at `used + prospective >= cap`, the first image
          // being the request it measures: room for N images is N - 1 more.
          prospectiveRequests: Math.max(0, images - 1),
        });
        if (violation !== null) {
          return { refused: budgetRefusalMessage(violation) };
        }
        await tx`
          UPDATE app.generations SET
            reserved_cost_cents = reserved_cost_cents + ${holdCents},
            updated_at_ms = ${Date.now()}
          WHERE thread_id = ${turn.threadId}
            AND org_id = ${turn.organizationId}
        `;
        return { refused: null };
      });
      if (verdict.refused !== null) {
        return { admitted: false, message: verdict.refused };
      }
      admitted += images;
      return { admitted: true, holdCents };
    },

    async settle({ holdCents, charges, provider, model }) {
      await sql.begin(async (tx) => {
        const timestamp = Date.now();
        for (const costCents of charges) {
          await incrementUsageLedger(tx, {
            organizationId: turn.organizationId,
            userId: turn.userId,
            agentSlug: CHAT_ASSISTANT_SLUG,
            ...(turn.apiKeyId !== undefined ? { apiKeyId: turn.apiKeyId } : {}),
            ...(turn.projectIds.length > 0
              ? { projectIds: turn.projectIds }
              : {}),
            provider,
            model,
            inputTokens: 0,
            outputTokens: 0,
            costEstimateCents: costCents,
            timestamp,
          });
        }
        if (holdCents > 0) {
          await tx`
            UPDATE app.generations SET
              reserved_cost_cents = greatest(0, reserved_cost_cents - ${holdCents}),
              updated_at_ms = ${timestamp}
            WHERE thread_id = ${turn.threadId}
              AND org_id = ${turn.organizationId}
          `;
        }
      });
    },
  };
}
