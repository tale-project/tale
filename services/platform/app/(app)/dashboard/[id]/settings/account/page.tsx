import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import AccountForm from './account-form';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Account page - renders directly without Suspense.
 * Data is preloaded server-side, so no skeleton is needed.
 */
export default async function AccountPage({ params }: PageProps) {
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId } = await params;

  // Preload member context for SSR + real-time reactivity
  const preloadedMemberContext = await preloadQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

  return (
    <AccountForm
      organizationId={organizationId}
      preloadedMemberContext={preloadedMemberContext}
    />
  );
}
