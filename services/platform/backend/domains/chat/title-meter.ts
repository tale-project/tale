import type { Sql } from 'postgres';

import type { TitleMeter } from '../../core/chat/generate_title.ts';
import {
  type DirectCallSubject,
  isDirectCallLease,
  openTokenCall,
  releaseDirectCall,
  settleTokenCall,
} from '../governance/direct-calls.ts';

/** The longest a naming call may hold its worst case: its own 10 s race,
 * with room to spare. */
const TITLE_CALL_MAX_MS = 2 * 60 * 1000;

/**
 * The `chat.generate_title` job's meter: the naming call is a direct call
 * (`governance/direct-calls.ts`) under the thread's member, with the API key
 * that sent the message and the thread's project — held against their
 * limits while it runs, so a member at a limit gets the derived title and
 * no call, and booked under `thread-title` in the hold's place after it.
 */
export function titleMeter(
  sql: Sql,
  args: { organizationId: string; subject: DirectCallSubject },
): TitleMeter {
  return {
    async open(call) {
      const admission = await openTokenCall(sql, {
        organizationId: args.organizationId,
        provider: call.provider,
        model: call.model,
        lane: 'title',
        subject: args.subject,
        promptTokens: call.promptTokens,
        maxOutputTokens: call.maxOutputTokens,
        maxDurationMs: TITLE_CALL_MAX_MS,
      });
      return admission.allowed ? { lease: admission.lease } : null;
    },
    async settle(lease, usage) {
      if (!isDirectCallLease(lease)) return;
      await settleTokenCall(sql, lease, {
        organizationId: args.organizationId,
        ...usage,
      });
    },
    async release(lease) {
      if (!isDirectCallLease(lease)) return;
      await releaseDirectCall(sql, lease);
    },
  };
}
