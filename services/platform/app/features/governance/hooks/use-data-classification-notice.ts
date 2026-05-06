'use client';

import { useTranslation } from 'react-i18next';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { isRecord } from '@/lib/utils/type-guards';

interface DataNoticeConfig {
  enabled: boolean;
  requireAcknowledgment?: boolean;
  messages?: Record<string, string>;
  version?: number;
}

export interface ResolvedDataNotice {
  /** Whether the notice should be rendered at all. */
  enabled: boolean;
  /** True when the org has flagged the notice as requiring an explicit
   *  one-time acknowledgment from each user. */
  requireAcknowledgment: boolean;
  /** Final resolved message for the current i18n locale, after the
   *  org-override → org-default-locale → platform-default → 'en'
   *  fallback chain. */
  message: string;
  /** Bumped by admins to force re-acknowledgment after substantive
   *  edits. Acknowledgment rows compare to this value. */
  version: number;
}

/**
 * Phase 12 — `useDataClassificationNotice` resolves the org's
 * confidentiality notice for the current i18n locale.
 *
 * Resolution order:
 *   1. Org override `messages[currentLocale]`
 *   2. Org override `messages.en` as a sane "any locale" fallback
 *   3. Platform default from `messages/{locale}.json` `dataNotice.default`
 *   4. Hardcoded English fallback in case the i18n bundle is missing
 *
 * `enabled === false` short-circuits everything — render nothing.
 */
export function useDataClassificationNotice(
  organizationId: string | undefined,
): ResolvedDataNotice {
  const { t, i18n } = useTranslation();
  const policy = useConvexQuery(
    api.governance.queries.getPolicy,
    organizationId
      ? { organizationId, policyType: 'data_classification_notice' as const }
      : 'skip',
  );

  const fallback = t(
    'dataNotice.default',
    'Treat this chat as you would email — avoid customer data, credentials, and unreleased information.',
  );

  if (policy?.data === undefined) {
    return {
      enabled: organizationId !== undefined,
      requireAcknowledgment: false,
      message: fallback,
      version: 1,
    };
  }

  const config = isRecord(policy.data?.config) ? policy.data.config : {};
  const cfg: DataNoticeConfig = {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
    requireAcknowledgment:
      typeof config.requireAcknowledgment === 'boolean'
        ? config.requireAcknowledgment
        : false,
    messages: isRecord(config.messages)
      ? (config.messages as Record<string, string>)
      : undefined,
    version: typeof config.version === 'number' ? config.version : 1,
  };

  const locale = i18n.language;
  const langPrefix = locale.split('-')[0];
  const overrideMsg =
    cfg.messages?.[locale] ?? cfg.messages?.[langPrefix] ?? cfg.messages?.en;

  return {
    enabled: cfg.enabled,
    requireAcknowledgment: cfg.requireAcknowledgment ?? false,
    message: overrideMsg ?? fallback,
    version: cfg.version ?? 1,
  };
}
