import { useMemo } from 'react';

import { useInboxAvailability } from '@/app/features/automations/builtin-views/registry';
import { useRequiredIntegrations } from '@/app/features/automations/hooks/use-required-integrations';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import {
  type EmailIntegrationOption,
  resolvedEmailOption,
} from '../lib/email-integrations';

export type Conversation = ConvexItemOf<
  typeof api.conversations.queries.listConversations
>;

export function useConversations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.conversations.queries.listConversations,
    { organizationId },
  );

  return {
    conversations: data ?? [],
    isLoading,
  };
}

interface ListConversationsPaginatedArgs {
  organizationId: string;
  status?: 'open' | 'closed' | 'spam' | 'archived';
  priority?: string;
  channel?: string;
  /** Filter to one connected inbox provider (e.g. `gmail`) — the Inbox
   *  toolbar's channel filter. */
  integrationName?: string;
  initialNumItems: number;
}

export function useListConversationsPaginated(
  args: ListConversationsPaginatedArgs,
) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.conversations.queries.listConversationsPaginated,
    queryArgs,
    { initialNumItems },
  );
}

export function useApproxConversationCountByStatus(
  organizationId: string,
  status: 'open' | 'closed' | 'spam' | 'archived',
) {
  return useConvexQuery(
    api.conversations.queries.approxCountConversationsByStatus,
    {
      organizationId,
      status,
    },
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
  const { data, isLoading } = useConvexQuery(
    api.contacts.queries.listContacts,
    contactId ? { organizationId } : 'skip',
  );

  if (!contactId) return { name: undefined, isLoading: false };

  const contact = data?.find((c) => c._id === contactId);
  return {
    name: contact ? contact.name || contact.email : undefined,
    isLoading,
  };
}

/**
 * The inboxes the compose dialog can send through — exactly the Inbox's own
 * connected providers, so compose can never disagree with the page it lives on
 * (reaching the Inbox already requires an installed email automation whose
 * provider is connected). Derived from the installed inbox automations'
 * `requiredIntegrations[0]` (the provider, as the channel filter reads it),
 * resolved through {@link useRequiredIntegrations} — which merges the file
 * config (title, type, connectionConfig) with the credential and reports the
 * authoritative `connected` (`isActive && status === 'active'`) status.
 */
export function useEmailIntegrations(organizationId: string): {
  emailIntegrations: EmailIntegrationOption[];
  isLoading: boolean;
} {
  const { inboxAutomations, isLoading: inboxLoading } =
    useInboxAvailability(organizationId);

  const providerSlugs = useMemo(
    () => [
      ...new Set(
        inboxAutomations
          .map((automation) => automation.requiredIntegrations[0])
          .filter((slug): slug is string => Boolean(slug)),
      ),
    ],
    [inboxAutomations],
  );

  const { required, isLoading: requiredLoading } = useRequiredIntegrations(
    organizationId,
    providerSlugs,
  );

  const emailIntegrations = useMemo(
    () =>
      required
        .filter((r) => r.connected)
        .map((r) => resolvedEmailOption(r.slug, r.integration)),
    [required],
  );

  return {
    emailIntegrations,
    isLoading: inboxLoading || requiredLoading,
  };
}

export function useConversationWithMessages(conversationId: string | null) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.conversations.queries.getConversationWithMessages,
    conversationId && organizationId
      ? {
          conversationId: toId<'conversations'>(conversationId),
          organizationId,
        }
      : 'skip',
  );
}
