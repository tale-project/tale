'use client';

import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';

import { channelOptionsOf } from '../lib/channel-source';
import { useEmailConnectors, useMailboxes } from './queries';

// Stable identity so downstream memos don't re-run every render.
const EMPTY_CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [];

/**
 * The Inbox's channel-filter options: every lane a thread can arrive on.
 *
 * Email connectors come from the installed inbox automations' required
 * connectors, named by their credential's title; a connector holding several
 * mailboxes lists each of them instead. API sources come from the threads
 * themselves — an integration names its own source slug, so there is no
 * catalog to read it from.
 *
 * The value is what the server filters on (`connectorName`, or one mailbox's
 * credential), so the namespaces share one list without colliding.
 */
export function useInboxChannelOptions(
  organizationId: string,
): Array<{ value: string; label: string }> {
  const { t } = useT('conversations');
  const { emailConnectors } = useEmailConnectors(organizationId);
  const { mailboxes } = useMailboxes();
  const { data: apiSources } = useBackendQuery(
    'conversations/queries:apiSources',
    organizationId ? { organizationId } : 'skip',
  );

  return useMemo(() => {
    const options = channelOptionsOf(
      emailConnectors,
      apiSources ?? [],
      mailboxes,
      (name) => t('filter.mailboxInactive', { name }),
    );
    return options.length === 0 ? EMPTY_CHANNEL_OPTIONS : options;
  }, [emailConnectors, apiSources, mailboxes, t]);
}
