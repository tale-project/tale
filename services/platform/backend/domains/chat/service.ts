import type { Sql } from 'postgres';

import type { TurnOutcome } from '../../../lib/chat/turn.ts';
import {
  executeTurn,
  type ExecuteTurnArgs,
} from '../../core/chat/turn_action.ts';
import { settleDeferredSendOnUserAppend } from '../../core/chat/turn_store.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { chatShimHandlers } from './shim.ts';
import { createPgTurnStore, createPgUsageLedger } from './store.ts';

/**
 * The chat lane's host: one user turn end to end, by REUSING the 0.4
 * `executeTurn` verbatim — model resolution, attachment gate, history
 * budget, context assembly, guardrails, tool rounds, streaming — with its
 * two write ports swapped for Postgres (`createPgTurnStore`,
 * `createPgUsageLedger`) and every `ctx.run*` dispatched through
 * `chatShimHandlers`. The 0.4 tool executor (`rag_search` / `rag_fetch` /
 * `web_fetch`) is NOT overridden: `executeTurn` builds it on the same shim
 * ctx, so the fixed three-tool loadout runs unchanged over 0.5 SQL.
 *
 * Same execution contract as the 0.4 action host: the caller awaits the
 * turn (at-most-once, no retry — an LLM spend must not replay), streaming
 * progress lands on `app.generations` (polled by the stream lane, see
 * `store.ts`), and
 * cancel is a flag on that row the throttled progress writes read back.
 */

export interface ChatTurnRequest {
  readonly organizationId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly userText: string;
  readonly attachments?: ExecuteTurnArgs['attachments'];
  readonly modelId?: string;
  readonly providerSlug?: string;
  readonly reasoningEffort?: ExecuteTurnArgs['reasoningEffort'];
  readonly locale?: string;
  readonly resend?: boolean;
  /** Auto — the server resolves a concrete (provider, model) pair for THIS
   * message before anything binds. Exactly one of modelId / this. */
  readonly modelSelection?: 'auto';
  /** Runs the moment the turn-open write persisted the user message — the
   * deferred-send lane settles its tray row here, so the parked message is
   * never shown twice (bubble + "sending" row) for the whole generation.
   * Never called on a turn that refused or threw before that write. */
  readonly onUserMessageAppended?: () => Promise<void>;
}

export async function runChatTurn(
  sql: Sql,
  request: ChatTurnRequest,
): Promise<TurnOutcome> {
  const shim = createCtxShim(chatShimHandlers(sql));
  const args: ExecuteTurnArgs = {
    organizationId: request.organizationId,
    userId: request.userId,
    threadId: request.threadId,
    userText: request.userText,
    ...(request.attachments !== undefined
      ? { attachments: request.attachments }
      : {}),
    ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
    ...(request.modelSelection !== undefined
      ? { modelSelection: request.modelSelection }
      : {}),
    ...(request.providerSlug !== undefined
      ? { providerSlug: request.providerSlug }
      : {}),
    ...(request.reasoningEffort !== undefined
      ? { reasoningEffort: request.reasoningEffort }
      : {}),
    sandbox: false,
    locale: request.locale ?? 'en',
    ...(request.resend === true ? { resend: true } : {}),
  };
  const store = createPgTurnStore(sql);
  return executeTurn(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 host; every ctx facility it touches is covered by chatShimHandlers
    shim as unknown as Parameters<typeof executeTurn>[0],
    args,
    {
      deps: {
        store:
          request.onUserMessageAppended !== undefined
            ? settleDeferredSendOnUserAppend(
                store,
                request.onUserMessageAppended,
              )
            : store,
        usage: createPgUsageLedger(sql),
      },
    },
  );
}
