import type { ChatFilterConfig } from '../../../lib/shared/schemas/governance';
import {
  blocked,
  flagged,
  modified,
  pass,
  type FilterOutcome,
} from '../filter_outcome';
import { detectViolations } from './detector';
import { applyEnforcement } from './enforcer';

export interface RunChatFilterInput {
  text: string;
  config: ChatFilterConfig;
  policyDocId: string;
  updatedAt: number;
}

/**
 * Pure entry point for chat_filter. Returns a `FilterOutcome` — never throws.
 * Streaming transforms call this per-delta (with a sliding lookback window
 * captured in the caller's closure); the `sanitize.ts` dispatcher calls it
 * once per full input message.
 */
export function runChatFilter(input: RunChatFilterInput): FilterOutcome {
  const { text, config, policyDocId, updatedAt } = input;

  if (!config.enabled) return pass();

  const detection = detectViolations(text, {
    policyDocId,
    updatedAt,
    categories: config.categories,
  });

  const enforced = applyEnforcement(
    text,
    detection.matches,
    config.categories,
    config.maskReplacement,
  );

  switch (enforced.kind) {
    case 'pass':
      return pass();
    case 'flagged':
      return flagged(
        enforced.flaggedCategories,
        enforced.matchCount,
        detection.truncated,
      );
    case 'modified':
      return modified(
        enforced.text,
        [...enforced.maskedCategories, ...enforced.flaggedCategories],
        enforced.matchCount,
        detection.truncated,
      );
    case 'blocked':
      return blocked(
        enforced.blockedCategories,
        enforced.matchCount,
        detection.truncated,
      );
    default:
      return pass();
  }
}

export { DEFAULT_CHAT_FILTER_CATEGORIES } from './categories';
export { detectViolations, resetCompilationCacheForTesting } from './detector';
export { applyEnforcement } from './enforcer';
export type { ChatFilterMatch } from './detector';
