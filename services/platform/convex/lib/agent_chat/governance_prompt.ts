'use node';

import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

/**
 * Fetch the mandatory system prompt governance policy.
 * Skipped for sub-agents to prevent double-injection in delegation chains.
 */
export async function fetchGovernanceSystemPrompt(
  ctx: ActionCtx,
  organizationId: string,
  parentThreadId: string | undefined,
): Promise<{ mandatoryPrefix: string; mandatorySuffix: string }> {
  if (parentThreadId) {
    return { mandatoryPrefix: '', mandatorySuffix: '' };
  }

  const systemPromptPolicy = await ctx.runQuery(
    internal.governance.internal_queries.getSystemPromptPolicyInternal,
    { organizationId },
  );

  let mandatoryPrefix = '';
  let mandatorySuffix = '';

  if (
    systemPromptPolicy?.enabled !== false &&
    isRecord(systemPromptPolicy?.config)
  ) {
    const cfg = systemPromptPolicy.config;
    if (
      typeof cfg.mandatoryPrefixPrompt === 'string' &&
      cfg.mandatoryPrefixPrompt.trim()
    ) {
      mandatoryPrefix = cfg.mandatoryPrefixPrompt.trim();
    }
    if (
      typeof cfg.mandatorySuffixPrompt === 'string' &&
      cfg.mandatorySuffixPrompt.trim()
    ) {
      mandatorySuffix = cfg.mandatorySuffixPrompt.trim();
    }
  }

  return { mandatoryPrefix, mandatorySuffix };
}
