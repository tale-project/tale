import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import { ConversationsWrapper } from '../components/conversations-wrapper';
import { fetchQuery, preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { ActivateConversationsEmptyState } from '../components/activate-conversations-empty-state';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('conversations.title'),
    description: t('conversations.description'),
  };
}

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ConversationStatus = (typeof VALID_STATUSES)[number];

function isValidConversationStatus(s: string): s is ConversationStatus {
  return VALID_STATUSES.includes(s as ConversationStatus);
}

interface ConversationsPageProps {
  params: Promise<{ id: string; status: string }>;
  searchParams: Promise<{
    category?: string;
    priority?: string;
    search?: string;
    page?: string;
  }>;
}

interface ConversationsContentProps {
  params: Promise<{ id: string; status: string }>;
  searchParams: Promise<{
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
  const token = await getAuthToken();
  const { id: organizationId, status } = await params;
  const { category, priority, search, page = '1' } = await searchParams;

  if (!token) {
    redirect('/log-in');
  }

  // Validate status parameter
  if (!isValidConversationStatus(status)) {
    notFound();
  }

  // Preload conversations for SSR + real-time reactivity on client
  const preloadedConversations = await preloadQuery(
    api.conversations.getConversationsPage,
    {
      organizationId,
      status: status as Doc<'conversations'>['status'],
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
      status={status as Doc<'conversations'>['status']}
      preloadedConversations={preloadedConversations}
      preloadedEmailProviders={preloadedEmailProviders}
    />
  );
}

export default async function ConversationsStatusPage({
  params,
  searchParams,
}: ConversationsPageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId, status } = await params;
  const { category, priority, search } = await searchParams;

  // Validate status parameter
  if (!isValidConversationStatus(status)) {
    notFound();
  }

  // Two-phase loading: check if conversations exist before showing skeleton
  // If no conversations AND no email providers configured, show activate empty state
  const hasActiveFilters = category || priority || search?.trim();

  if (!hasActiveFilters) {
    const [hasConversations, emailProviders] = await Promise.all([
      fetchQuery(
        api.conversations.hasConversations,
        { organizationId },
        { token },
      ),
      fetchQuery(api.email_providers.list, { organizationId }, { token }),
    ]);

    if (!hasConversations && emailProviders.length === 0) {
      return (
        <ActivateConversationsEmptyState organizationId={organizationId} />
      );
    }
  }

  return <ConversationsContent params={params} searchParams={searchParams} />;
}
