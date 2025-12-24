import { redirect } from 'next/navigation';

interface ConversationsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Conversations index page - redirects to /conversations/open.
 * The actual content is rendered at /conversations/[status].
 */
export default async function ConversationsPage({
  params,
}: ConversationsPageProps) {
  const { id: organizationId } = await params;
  redirect(`/dashboard/${organizationId}/conversations/open`);
}
