import { Suspense } from 'react';
import { preloadQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import AccountForm from './account-form';
import { Skeleton } from '@/components/ui/skeleton';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton matching the AccountForm layout exactly.
 * Shows: Title + 3 password fields + submit button in a centered container.
 */
function AccountFormSkeleton() {
  return (
    <div className="flex justify-center py-6">
      <div className="w-full max-w-md space-y-6">
        {/* Title */}
        <Skeleton className="h-7 w-40" />

        {/* Password fields */}
        <div className="space-y-4">
          {/* Current password */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          {/* New password */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          {/* Confirm password */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </div>

        {/* Submit button */}
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );
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
    <Suspense fallback={<AccountFormSkeleton />}>
      <AccountContent params={params} />
    </Suspense>
  );
}
