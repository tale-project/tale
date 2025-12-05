import { redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import ConversationsWrapper from './components/conversations-wrapper';
import { fetchQuery } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { SuspenseLoader } from '@/components/suspense-loader';

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

async function ConversationsContent({
  params,
  searchParams,
}: ConversationsPageProps) {

  const { id: organizationId } = await params;

  const { status, category, priority, search, page = '1' } = await searchParams;
  const statusParam = isValidConversationStatus(status) ? status : undefined;

  if (!statusParam) {
    redirect(`/dashboard/${organizationId}/conversations?status=open`);
  }
  // Fetch root conversations directly from Convex
  try {
    const token = await getAuthToken();
    if (!token) {
      redirect('/log-in');
    }
    const conversationsResult = await fetchQuery(
      api.conversations.getConversationsPage,
      {
        organizationId: organizationId as string,
        status: statusParam,
        page: parseInt(page),
        limit: 20,
        priority: priority && priority.length > 0 ? priority : undefined,
        category: category && category.length > 0 ? category : undefined,
        search: search && search.length > 0 ? search : undefined,
      },
      { token },
    );

    return (
      <ConversationsWrapper
        key={`${status}-${category}-${priority}-${search}`}
        status={statusParam}
        conversations={conversationsResult.conversations || []}
      />
    );
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <h2 className="text-lg font-semibold text-foreground">
          Unable to load conversations
        </h2>
        <p className="text-sm text-muted-foreground">
          Please try refreshing the page or contact support if the issue
          persists.
        </p>
      </div>
    );
  }
}

export default function ConversationsPage(props: ConversationsPageProps) {
  return (
    <SuspenseLoader>
      <ConversationsContent {...props} />
    </SuspenseLoader>
  );
}
