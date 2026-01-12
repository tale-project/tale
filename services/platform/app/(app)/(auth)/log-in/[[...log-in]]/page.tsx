import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { fetchQuery } from '@/lib/convex-next-server';
import { getCurrentUser } from '@/lib/auth/auth-server';
import { LogInForm } from '../components/log-in-form';
import { AuthFormSkeleton } from '../../components/auth-skeleton';
import { api } from '@/convex/_generated/api';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT('auth');
  return {
    title: t('login.title'),
    description: t('login.description'),
  };
}

/**
 * Check if Microsoft Entra ID authentication is configured
 */
function isMicrosoftAuthEnabled(): boolean {
  return Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
  );
}

/**
 * Cached check for user existence
 * Revalidates every hour (3600 seconds) since users don't get deleted often
 */
const getCachedHasAnyUsers = unstable_cache(
  async () => {
    return await fetchQuery(api.users.hasAnyUsers, {});
  },
  ['has-any-users'],
  {
    revalidate: 3600, // Cache for 1 hour
    tags: ['users'],
  },
);

async function LogInContent({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  // If user is already authenticated, redirect to redirectTo or dashboard
  if (user?.userId) {
    redirect(params.redirectTo || '/dashboard');
  }

  // Check if any users exist in the system (cached)
  const hasUsers = await getCachedHasAnyUsers();

  // If no users exist, redirect to sign-up page for initial setup
  if (!hasUsers) {
    redirect('/sign-up');
  }

  const microsoftEnabled = isMicrosoftAuthEnabled();

  return (
    <LogInForm
      userId={user?.userId || undefined}
      microsoftEnabled={microsoftEnabled}
    />
  );
}

export default async function LogInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { t } = await getT('auth');

  return (
    <Suspense
      fallback={
        <AuthFormSkeleton title={t('login.loginTitle')} showMicrosoftButton />
      }
    >
      <LogInContent searchParams={searchParams} />
    </Suspense>
  );
}
