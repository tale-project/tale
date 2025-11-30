import { getCurrentUser } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import AuthLayout from '@/components/auth-layout';
import SignUpForm from '@/components/auth/sign-up-form';
import { SuspenseLoader } from '@/components/suspense-loader';

export const metadata = {
  title: 'Create Account',
  description:
    'Create a Tale account to analyze customer churn rate, and automate your customer retention workflow.',
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

async function SignUpContent() {
  const user = await getCurrentUser();

  if (user && user.email) {
    redirect('/dashboard');
  }

  const microsoftEnabled = isMicrosoftAuthEnabled();

  return (
    <AuthLayout>
      <SignUpForm microsoftEnabled={microsoftEnabled} />
    </AuthLayout>
  );
}

export default function SignUpPage() {
  return (
    <SuspenseLoader>
      <SignUpContent />
    </SuspenseLoader>
  );
}
