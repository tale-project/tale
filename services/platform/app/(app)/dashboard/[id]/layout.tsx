'use client';

import { ReactNode, Suspense, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import NavigationWrapper from '@/components/navigation-wrapper';
import { api } from '@/convex/_generated/api';

export interface DashboardLayoutProps {
  children: ReactNode;
}

function DashboardLayoutContent({ children }: DashboardLayoutProps) {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // Get user context to check authentication
  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: id,
  });

  // Get organization to ensure it exists
  const organization = useQuery(api.organizations.getOrganization, {
    id,
  });

  // Handle redirects based on query results
  useEffect(() => {
    if (userContext === null) {
      // User not authenticated
      router.push('/log-in');
    } else if (organization === null) {
      // Organization doesn't exist
      router.push('/dashboard/create-organization');
    }
  }, [userContext, organization, router]);

  // Show nothing while checking auth/org or if redirecting
  if (userContext === undefined || organization === undefined) {
    return null;
  }

  if (userContext === null || organization === null) {
    return null;
  }

  return (
    <>
      <div className="flex justify-stretch size-full">
        <div className="flex-[0_0_52px] overflow-y-auto px-2">
          <NavigationWrapper organizationId={id} />
        </div>
        <div className="flex flex-col flex-[1_1_0] justify-stretch overflow-y-auto border-l border-border bg-background">
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <Suspense fallback={null}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}
