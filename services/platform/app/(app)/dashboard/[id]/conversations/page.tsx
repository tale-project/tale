import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import ConversationsWrapper from './components/conversations-wrapper';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { ListSkeleton } from '@/components/skeletons';

function isValidConversationStatus(
  s: string | undefined,
): s is Doc<'conversations'>['status'] {
  return s === 'open' || s === 'closed' || s === 'archived' || s === 'spam';
}

interface ConversationsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    category?: string;
    priority?: string;
    search?: string;
    page?: string;
  }>;
}

interface ConversationsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    category?: string;
    priority?: string;
    search?: string;
    page?: string;
  }>;
}

async function ConversationsContent({
  params,
  searchParams,
}: ConversationsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  const { id: organizationId } = await params;
  const { status, category, priority, search, page = '1' } = await searchParams;
  if (!token) {
    redirect('/log-in');
  }

  const statusParam = isValidConversationStatus(status) ? status : undefined;

  if (!statusParam) {
    redirect(`/dashboard/${organizationId}/conversations?status=open`);
  }

  // Preload conversations for SSR + real-time reactivity on client
  // Using preloadQuery instead of fetchQuery enables:
  // 1. Server-side rendering for fast initial page load
  // 2. Real-time updates after hydration via usePreloadedQuery
  const preloadedConversations = await preloadQuery(
    api.conversations.getConversationsPage,
    {
      organizationId,
      status: statusParam,
      page: parseInt(page),
      limit: 20,
      priority: priority && priority.length > 0 ? priority : undefined,
      category: category && category.length > 0 ? category : undefined,
      search: search && search.length > 0 ? search : undefined,
    },
    { token },
  );

  // Also preload email providers for the empty state check
  const preloadedEmailProviders = await preloadQuery(
    api.email_providers.list,
    { organizationId },
    { token },
  );

  return (
    <ConversationsWrapper
      key={`${status}-${category}-${priority}-${search}`}
      status={statusParam}
      preloadedConversations={preloadedConversations}
      preloadedEmailProviders={preloadedEmailProviders}
    />
  );
}

/** Skeleton for the conversations list */
function ConversationsSkeleton() {
  return (
    <ListSkeleton
      items={10}
      itemProps={{
        showAvatar: true,
        showSecondary: true,
        showAction: true,
      }}
    />
  );
}

export default function ConversationsPage({
  params,
  searchParams,
}: ConversationsPageProps) {
  return (
    <Suspense fallback={<ConversationsSkeleton />}>
      <ConversationsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
