import { redirect } from 'next/navigation';
import { fetchQuery } from 'convex/nextjs';
import { getCurrentUser } from '@/lib/auth/auth-server';
import AuthLayout from '@/components/auth-layout';
import LogInForm from '@/components/auth/log-in-form';
import { SuspenseLoader } from '@/components/suspense-loader';
import { api } from '@/convex/_generated/api';

export const metadata = {
  title: 'Tale Log In | Access your account',
  description:
    'Log in to your Tale account to analyze customer churn rate, and automate your customer retention workflow.',
};

/**
 * Check if Microsoft Entra ID authentication is configured
 */
function isMicrosoftAuthEnabled(): boolean {
  return Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
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

export default function LogInPage() {
  return (
    <SuspenseLoader>
      <LogInContent />
    </SuspenseLoader>
  );
}
