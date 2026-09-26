import { useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';

import type { MailboxEntry } from '../lib/channel-source';
import {
  resolvedEmailOption,
  type EmailConnectorOption,
} from '../lib/email-connectors';
import { useInboxAvailability } from './use-inbox-availability';

interface ListConversationsPaginatedArgs {
  organizationId: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  channel?: string;
  /** Filter to one connected inbox provider (e.g. `gmail`) — the Inbox
   *  toolbar's channel filter. */
  connectorName?: string;
  /** Filter to one mailbox (connector credential) of a connector that holds
   *  several. */
  credentialId?: string;
  initialNumItems: number;
  /** When false the read is skipped — an organization without an inbox has
   *  no conversations to ask for. */
  enabled?: boolean;
}

export function useListConversationsPaginated(
  args: ListConversationsPaginatedArgs,
) {
  const { initialNumItems, enabled = true, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    'conversations/queries:listConversationsPaginated',
    enabled ? queryArgs : 'skip',
    { initialNumItems },
  );
}

export function useApproxConversationCountByStatus(
  organizationId: string,
  status: 'open' | 'closed' | 'spam' | 'archived',
) {
  return useBackendQuery(
    'conversations/queries:approxCountConversationsByStatus',
    {
      organizationId,
      status,
    },
  );
}

/**
 * How many OPEN conversations still carry unread messages, in the caller's own
 * inbox scope — an admin counts the organization, everyone else only the rows
 * assigned to them or to one of their teams. Drives the rail's Inbox chip.
 *
 * Read state is per CONVERSATION, not per viewer (`metadata.unread_count`), so
 * a teammate opening a thread clears it for the whole queue. Pass `undefined`
 * to skip — the rail does that while the Inbox entry itself is hidden.
 *
 * Shares one request and one cache entry with the status tab badges: both
 * narrow the same `/conversations/counts` body.
 */
export function useUnreadConversationCount(organizationId: string | undefined) {
  return useBackendQuery(
    'conversations/queries:countUnreadConversations',
    organizationId === undefined ? 'skip' : { organizationId },
  );
}

/**
 * A contact's display name for the Inbox's not-yet-installed empty state, when
 * a `?composeContact=` deep link (a contact-row "New email" action) arrives
 * before any mailbox is connected (#2641) — names the contact in the "install
 * an automation first" notice instead of silently dropping the intent. Pass
 * `undefined` to skip: every other view that resolves a contact by id already
 * carries its own `useContacts` subscription (e.g. `conversation-header.tsx`),
 * so this only fetches the org's contact list when this specific lookup is
 * pending.
 */
export function useComposeContactName(
  organizationId: string,
  contactId: string | undefined,
): { name: string | undefined; isLoading: boolean } {
  const { data, isLoading } = useBackendQuery(
    'contacts/queries:listContacts',
    contactId ? { organizationId } : 'skip',
  );

  if (!contactId) return { name: undefined, isLoading: false };

  const contact = data?.find((c) => c._id === contactId);
  return {
    name: contact ? contact.name || contact.email : undefined,
    isLoading,
  };
}

/** The connectors whose credentials are email mailboxes. */
export const EMAIL_PROVIDER_SLUGS: ReadonlySet<string> = new Set([
  'gmail',
  'outlook',
  'imap-smtp',
]);

/**
 * The mailboxes the compose dialog can send through — the Inbox's connected
 * providers from installed inbox automations' `requiredConnectors`, resolved
 * against active connector credentials. One option per credential, not per
 * connector: an organization may hold several mailboxes on one connector.
 */
export function useEmailConnectors(organizationId: string): {
  emailConnectors: EmailConnectorOption[];
  isLoading: boolean;
} {
  const { inboxAutomations, isLoading: inboxLoading } =
    useInboxAvailability(organizationId);

  const providerSlugs = useMemo(
    () => [
      ...new Set(
        inboxAutomations
          .map((automation) => automation.requiredConnectors[0])
          .filter(
            (slug): slug is string =>
              typeof slug === 'string' && EMAIL_PROVIDER_SLUGS.has(slug),
          ),
      ),
    ],
    [inboxAutomations],
  );

  const { data: credentials, isLoading: credentialsLoading } = useBackendQuery(
    'connector_credentials/queries:listCredentials',
    organizationId ? { organizationId } : 'skip',
  );

  const emailConnectors = useMemo(() => {
    if (!credentials || providerSlugs.length === 0)
      return EMPTY_EMAIL_CONNECTORS;
    const active = credentials.filter((row) => row.status === 'active');
    const options: EmailConnectorOption[] = [];
    for (const slug of providerSlugs) {
      for (const row of active) {
        if (row.connectorSlug !== slug) continue;
        options.push({
          ...resolvedEmailOption(slug, {
            title: row.name,
            type: slug === 'imap-smtp' ? 'imap_smtp' : 'oauth',
            connectionConfig: row.config,
          }),
          credentialId: row.id,
        });
      }
    }
    return options.length === 0 ? EMPTY_EMAIL_CONNECTORS : options;
  }, [credentials, providerSlugs]);

  return {
    emailConnectors,
    isLoading: inboxLoading || credentialsLoading,
  };
}

// Stable identity so consumers' memos don't re-run every render.
const EMPTY_EMAIL_CONNECTORS: EmailConnectorOption[] = [];

/**
 * The organization's mailboxes (every connector credential), for any surface
 * that names where a thread came in — pass them to `channelSourceOf`. Reads
 * the org from context and shares `useEmailConnectors`' cached credentials
 * query, so a list of rows costs one directory read rather than one per row.
 *
 * Every credential, not one per connector: an organization may hold several
 * mailboxes on one connector, and a thread names its own by `credentialId`.
 */
export function useMailboxes(): { mailboxes: readonly MailboxEntry[] } {
  const organizationId = useOrganizationId();
  const { data } = useBackendQuery(
    'connector_credentials/queries:listCredentials',
    organizationId ? { organizationId } : 'skip',
  );
  return { mailboxes: data ?? EMPTY_MAILBOXES };
}

// Stable identity so consumers' memos don't re-run every render.
const EMPTY_MAILBOXES: MailboxEntry[] = [];

export function useConversationWithMessages(conversationId: string | null) {
  const organizationId = useOrganizationId();
  return useBackendQuery(
    'conversations/queries:getConversationWithMessages',
    conversationId && organizationId
      ? {
          conversationId: conversationId,
          organizationId,
        }
      : 'skip',
  );
}
