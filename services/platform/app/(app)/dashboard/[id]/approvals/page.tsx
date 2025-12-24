import { redirect } from 'next/navigation';

interface ApprovalsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Approvals index page - redirects to /approvals/pending.
 * The actual content is rendered at /approvals/[status].
 */
export default async function ApprovalsPage({ params }: ApprovalsPageProps) {
  const { id: organizationId } = await params;
  redirect(`/dashboard/${organizationId}/approvals/pending`);
}
