'use client';

import { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import SettingsNavigation from './settings-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface SettingsLayoutProps {
  children: ReactNode;
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const params = useParams();
  const organizationId = params.id as string;

  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId,
  });

  const userRole = userContext?.member?.role ?? 'Member';
  const canChangePassword = userContext?.canChangePassword ?? true;

  return (
    <>
      {/* Title Section */}
      <div className="px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Settings</h1>
      </div>
      {/* Navigation */}
      <SettingsNavigation
        userRole={userRole}
        canChangePassword={canChangePassword}
      />
      {/* Content Area */}
      <ErrorBoundaryWithParams>
        <div className="flex flex-col flex-[1_1_0] px-4 py-6">{children}</div>
      </ErrorBoundaryWithParams>
    </>
  );
}
