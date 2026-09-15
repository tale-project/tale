'use client';

import { useTranslation } from 'react-i18next';

import { useBackendQuery } from '@/app/hooks/use-backend-query';

import {
  dataNoticePolicyArgs,
  readDataNoticeSettings,
  resolveDataNoticeMessage,
} from '../lib/data-notice';

export interface ResolvedDataNotice {
  /** Whether the notice should be rendered at all. */
  enabled: boolean;
  /** The text for the current locale (see `resolveDataNoticeMessage`). */
  message: string;
  /** The policy read has answered — `enabled` is the org's real setting
   *  rather than the hidden stand-in shown while loading or after a failure. */
  settled: boolean;
}

/**
 * Resolve the org's confidentiality notice for the current i18n locale.
 *
 * The notice is opt-in: it shows only once the policy read answers with
 * `enabled: true`. While the read is loading, when no org is in scope, when
 * the org has no policy file, and when the read fails, nothing renders —
 * never a default that could flash in and then vanish for an org that keeps
 * the notice off.
 *
 * Acknowledgment removed: the prior `requireAcknowledgment` + version
 * fields drove a blocking modal that did not actually gate input
 * (Esc/X/Later all bypassed). The B2B self-host model treats the
 * deploying org as the data controller, so end-user explicit consent
 * UX is product-incongruent. Both fields stay in the policy schema for a
 * future regulated-customer rewire; this hook does not return them.
 */
export function useDataClassificationNotice(
  organizationId: string | undefined,
): ResolvedDataNotice {
  // Each top-level key in messages/{locale}.yml is a separate i18next
  // namespace; calling useTranslation() with no arg binds to the default
  // namespace ('translation'), which doesn't exist in this app — so the
  // DE/FR fallbacks under `dataNotice.default` were unreachable and the
  // hook always returned the inline English fallback regardless of locale.
  const { t, i18n } = useTranslation('dataNotice');
  const policy = useBackendQuery(
    'governance/queries:getPolicy',
    organizationId ? dataNoticePolicyArgs(organizationId) : 'skip',
  );

  const platformDefault = t(
    'default',
    'AI can make mistakes—verify responses and do not share sensitive data.',
  );

  if (policy.data === undefined) {
    return { enabled: false, message: platformDefault, settled: false };
  }

  const settings = readDataNoticeSettings(policy.data?.config);
  return {
    enabled: settings.enabled,
    message: resolveDataNoticeMessage(
      settings.messages,
      i18n.language,
      platformDefault,
    ),
    settled: true,
  };
}
