'use client';

import { useTranslation } from 'react-i18next';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { isRecord } from '@/lib/utils/type-utils';

interface DataNoticeConfig {
  enabled: boolean;
  messages?: Record<string, string>;
}

export interface ResolvedDataNotice {
  /** Whether the notice should be rendered at all. */
  enabled: boolean;
  /** Final resolved message for the current i18n locale, after the
   *  org-override → org-default-locale → platform-default → 'en'
   *  fallback chain. */
  message: string;
}

/**
 * Resolve the org's confidentiality notice for the current i18n locale.
 *
 * Resolution order:
 *   1. Org override `messages[currentLocale]`
 *   2. Org override `messages.en` as a sane "any locale" fallback
 *   3. Platform default from `messages/{locale}.json` `dataNotice.default`
 *   4. Hardcoded English fallback in case the i18n bundle is missing
 *
 * `enabled === false` short-circuits everything — render nothing.
 *
 * Acknowledgment removed: the prior `requireAcknowledgment` + version
 * fields drove a blocking modal that did not actually gate input
 * (Esc/X/Later all bypassed). The B2B self-host model treats the
 * deploying org as the data controller, so end-user explicit consent
 * UX is product-incongruent. The server-side `policyAcknowledgements`
 * API + schema are preserved unchanged for a future regulated-customer
 * rewire; this hook simply stops returning the ack-related fields.
 */
export function useDataClassificationNotice(
  organizationId: string | undefined,
): ResolvedDataNotice {
  // Each top-level key in messages/{locale}.json is a separate i18next
  // namespace; calling useTranslation() with no arg binds to the default
  // namespace ('translation'), which doesn't exist in this app — so the
  // DE/FR fallbacks under `dataNotice.default` were unreachable and the
  // hook always returned the inline English fallback regardless of locale.
  const { t, i18n } = useTranslation('dataNotice');
  const policy = useConvexQuery(
    'governance/queries:getPolicy',
    organizationId
      ? { organizationId, policyType: 'data_classification_notice' }
      : 'skip',
  );

  const fallback = t(
    'default',
    'Treat this chat as you would email — avoid customer data, credentials, and unreleased information.',
  );

  // While the query is loading (`data === undefined`) or skipped (no org),
  // render nothing. Defaulting to `enabled: true` during load caused a
  // show→hide flash for orgs whose stored policy resolves to disabled: the
  // notice appeared on the loading default, then vanished once the real
  // config arrived. Once the policy resolves, a missing row (`data === null`)
  // falls through to the product default (on) below, so a never-configured
  // org still gets a stable notice — it just appears when the data lands
  // rather than flashing in and out.
  if (policy.data === undefined) {
    return {
      enabled: false,
      message: fallback,
    };
  }

  const config = isRecord(policy.data?.config) ? policy.data.config : {};
  const cfg: DataNoticeConfig = {
    enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
    messages: isRecord(config.messages)
      ? Object.fromEntries(
          Object.entries(config.messages).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined,
  };

  const locale = i18n.language;
  const langPrefix = locale.split('-')[0];
  const overrideMsg =
    cfg.messages?.[locale] ?? cfg.messages?.[langPrefix] ?? cfg.messages?.en;

  return {
    enabled: cfg.enabled,
    message: overrideMsg ?? fallback,
  };
}
