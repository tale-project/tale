/**
 * Whether the org's Inbox (the conversations surface) is available, and which
 * installed inbox automations feed it.
 *
 * TWO signals, because there are two ways an Inbox gets fed:
 *
 *  - a **deployed** automation declares the `inbox` builtin view on its
 *    presentation (seeded from the pack manifest's `builtinViews`) — the
 *    mailbox sync packs, gmail / outlook / imap-smtp;
 *  - the org **already has conversations**. A product that owns its own
 *    customer surface posts them to `/api/v1/conversations` and replies through
 *    a channel connector; it installs no mail pack and connects no mailbox, so
 *    the automation signal alone would hide the Inbox from an org whose Inbox
 *    is in active use. Any existing status or conversation type is the more
 *    direct evidence of the same thing the automation signal was standing in
 *    for.
 *
 * Compose and the channel filter still use each pack's `requiredConnectors`
 * (mail provider first) merged with active credentials — an org on the second
 * signal alone has none, which is correct: there is no mailbox to compose from.
 */

import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { parseAutomationPresentation } from '@/lib/shared/schemas/automation_presentation';

export interface InboxAutomationSummary {
  slug: string;
  /** The first entry is the inbox provider (gmail / outlook / imap-smtp). */
  requiredConnectors: string[];
}

function presentationRecord(value: unknown): {
  builtinViews?: Array<{ id: string }>;
  requiredConnectors?: string[];
} | null {
  const parsed = parseAutomationPresentation(value);
  if (parsed === null) return null;
  return parsed;
}

export function useInboxAvailability(organizationId: string): {
  isLoading: boolean;
  hasInbox: boolean;
  inboxAutomations: InboxAutomationSummary[];
} {
  const { data, isLoading } = useBackendQuery(
    'automations/queries:listAutomations',
    organizationId ? { organizationId, includeProjectBound: true } : 'skip',
  );

  // The second signal is any existing conversation. API-fed inboxes may only
  // have closed, archived, or spam threads when a member first opens the view.
  const openCount = useBackendQuery(
    'conversations/queries:approxCountConversationsByStatus',
    organizationId ? { organizationId, status: 'open' } : 'skip',
  );
  const closedCount = useBackendQuery(
    'conversations/queries:approxCountConversationsByStatus',
    organizationId ? { organizationId, status: 'closed' } : 'skip',
  );
  const archivedCount = useBackendQuery(
    'conversations/queries:approxCountConversationsByStatus',
    organizationId ? { organizationId, status: 'archived' } : 'skip',
  );
  const spamCount = useBackendQuery(
    'conversations/queries:approxCountConversationsByStatus',
    organizationId ? { organizationId, status: 'spam' } : 'skip',
  );
  const statusCounts = [openCount, closedCount, archivedCount, spamCount];

  const inboxAutomations = useMemo(() => {
    if (!data) return [];
    const out: InboxAutomationSummary[] = [];
    for (const row of data) {
      if (row.deployedVersion === undefined) continue;
      const presentation = presentationRecord(row.presentation);
      const views = presentation?.builtinViews ?? [];
      if (!views.some((view) => view.id === 'inbox')) continue;
      const requiredConnectors = (
        presentation?.requiredConnectors ?? []
      ).filter((slug) => slug !== 'conversation');
      out.push({ slug: row.name, requiredConnectors });
    }
    return out;
  }, [data]);

  return {
    isLoading: isLoading || statusCounts.some((count) => count.isLoading),
    hasInbox:
      inboxAutomations.length > 0 ||
      statusCounts.some((count) => (count.data ?? 0) > 0),
    inboxAutomations,
  };
}
