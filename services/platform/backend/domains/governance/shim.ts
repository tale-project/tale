import type { Sql } from 'postgres';

import { isFilePolicyType } from '../../../lib/shared/schemas/governance.ts';
import type { ChatFilterEventInput } from '../../core/governance/chat_filter_events.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { runModerationProvider, type RunModerationArgs } from './moderation.ts';
import { recordChatFilterEvent } from './settings-tail.ts';

/**
 * The governance seams a reused 0.4 host dispatches by name — hosted on
 * the 0.5 policy reader and the governance tables, so every ctx-shim host
 * (the chat turn, the task-agent turn, the providers vision-model read)
 * answers them from ONE table rather than each growing its own copy.
 */
export function governanceShimHandlers(sql: Sql): ShimHandlers {
  return {
    'governance/internal_queries:getPolicyConfigInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the reused 0.4 caller passes exactly this shape
      const args = raw as { organizationId: string; policyType: string };
      // An unknown policy type reads as "no policy configured" — the 0.4
      // internal query answered null for an absent file the same way.
      if (!isFilePolicyType(args.policyType)) return null;
      return readGovernancePolicyForOrg(
        sql,
        args.organizationId,
        args.policyType,
      );
    },
    'governance/internal_actions:runModerationProvider': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat host passes exactly this shape
      const args = raw as RunModerationArgs;
      return runModerationProvider(sql, args);
    },
    'governance/internal_mutations:recordChatFilterEvent': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the chat host passes exactly this shape
      const args = raw as { organizationId: string } & ChatFilterEventInput;
      await recordChatFilterEvent(sql, args.organizationId, args);
      return null;
    },
  };
}
