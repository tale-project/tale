import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { getCurrentUser } from '@/lib/auth/auth-server';
import AuthLayout from '@/components/auth-layout';
import LogInForm from '@/components/auth/log-in-form';
import { FormSkeleton } from '@/components/skeletons';
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

async function LogInContent() {
  const user = await getCurrentUser();

  // Check if any users exist in the system
  const hasUsers = await fetchQuery(api.users.hasAnyUsers, {});

  // If no users exist, redirect to sign-up page for initial setup
  if (!hasUsers) {
    redirect('/sign-up');
  }

  const microsoftEnabled = isMicrosoftAuthEnabled();

  return (
    <AuthLayout>
      <LogInForm
        userId={user?.userId || undefined}
        microsoftEnabled={microsoftEnabled}
      />
    </AuthLayout>
  );
}

/** Skeleton for the log-in form */
function LogInSkeleton() {
  return (
    <AuthLayout>
      <div className="max-w-md mx-auto">
        <FormSkeleton fields={2} />
      </div>
    </AuthLayout>
  );
}

export default function LogInPage() {
  return (
    <Suspense fallback={<LogInSkeleton />}>
      <LogInContent />
    </Suspense>
  );
}
