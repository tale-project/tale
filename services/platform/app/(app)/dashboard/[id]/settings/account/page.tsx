import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import AccountForm from './account-form';
import { SuspenseLoader } from '@/components/suspense-loader';
import { FormSkeleton } from '@/components/skeletons';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function AccountContent({ params }: PageProps) {
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

export default function AccountPage({ params }: PageProps) {
  return (
    <SuspenseLoader fallback={<FormSkeleton fields={3} />}>
      <AccountContent params={params} />
    </SuspenseLoader>
  );
}
