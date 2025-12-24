import { ReactNode } from 'react';
import { api } from '@/convex/_generated/api';
import SettingsNavigation from './settings-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import {
  ContentWrapper,
  PageHeader,
  PageHeaderTitle,
} from '@/components/layout';

interface SettingsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Settings Layout - Server Component
 *
 * This layout fetches member context to determine which navigation items
 * to show based on user role. The navigation is rendered directly without
 * Suspense to eliminate skeleton flash.
 *
 * Note: The parent dashboard layout already validates auth, so we can
 * rely on that for the initial auth check.
 */
export default async function SettingsLayout({
  children,
  params,
}: SettingsLayoutProps) {
  const { id: organizationId } = await params;
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const userContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

  const userRole = userContext?.member?.role ?? 'Member';
  const canChangePassword = userContext?.canChangePassword ?? true;

  return (
    <>
      <PageHeader>
        <PageHeaderTitle>Settings</PageHeaderTitle>
      </PageHeader>
      <SettingsNavigation
        userRole={userRole}
        canChangePassword={canChangePassword}
      />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
