import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import SignUpForm from '@/components/auth/sign-up-form';
import { FormSkeleton } from '@/components/skeletons';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT('auth');
  return {
    title: t('signup.title'),
    description: t('signup.description'),
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

async function SignUpContent() {
  const user = await getCurrentUser();

  if (user && user.email) {
    redirect('/dashboard');
  }

  const microsoftEnabled = isMicrosoftAuthEnabled();

  return <SignUpForm microsoftEnabled={microsoftEnabled} />;
}

/** Skeleton for the sign-up form */
function SignUpSkeleton() {
  return (
    <div className="max-w-md mx-auto">
      <FormSkeleton fields={3} />
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<SignUpSkeleton />}>
      <SignUpContent />
    </Suspense>
  );
}
