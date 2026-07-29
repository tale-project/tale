import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { type EmailConnectorOption } from '../lib/email-connectors';

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
  connectorName?: string;
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
 * The inboxes the compose dialog can send through. These were derived from
 * the installed inbox automations' `requiredConnectors` merged with the
 * connector credentials — both live in the automations/connectors
 * backend, which is offline while it is rebuilt. Until then no send-capable
 * inbox can be resolved, so compose degrades to its "no connected mailbox"
 * empty state while existing conversations stay readable.
 */
export function useEmailConnectors(_organizationId: string): {
  emailConnectors: EmailConnectorOption[];
  isLoading: boolean;
} {
  return { emailConnectors: EMPTY_EMAIL_CONNECTORS, isLoading: false };
}

// Stable identity so consumers' memos don't re-run every render.
const EMPTY_EMAIL_CONNECTORS: EmailConnectorOption[] = [];

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
