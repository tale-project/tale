import { ReactNode, Suspense } from 'react';
import { connection } from 'next/server';
import { api } from '@/convex/_generated/api';
import SettingsNavigation from './settings-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { fetchQuery } from '@/lib/convex-next-server';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { NavigationSkeleton } from '@/components/skeletons';

interface SettingsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

async function SettingsNavigationWrapper({
  organizationId,
}: {
  organizationId: string;
}) {
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
    <SettingsNavigation
      userRole={userRole}
      canChangePassword={canChangePassword}
    />
  );
}

export default async function SettingsLayout({
  children,
  params,
}: SettingsLayoutProps) {
  // Opt out of static rendering since this layout accesses cookies for auth
  await connection();
  const { id: organizationId } = await params;

  return (
    <>
      {/* Title Section */}
      <div className="px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
      </div>
      {/* Navigation - streams independently */}
      <Suspense fallback={<NavigationSkeleton items={3} />}>
        <SettingsNavigationWrapper organizationId={organizationId} />
      </Suspense>
      {/* Content Area */}
      <ErrorBoundaryWithParams>
        <div className="flex flex-col flex-[1_1_0] px-4 py-6">{children}</div>
      </ErrorBoundaryWithParams>
    </>
  );
}
