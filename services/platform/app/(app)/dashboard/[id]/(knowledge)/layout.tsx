import { ReactNode, Suspense } from 'react';
import KnowledgeNavigation from './knowledge-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { NavigationSkeleton } from '@/components/skeletons';

interface KnowledgeLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

async function KnowledgeNavigationWrapper({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // All dynamic data access inside Suspense boundary for proper streaming
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

  return (
    <KnowledgeNavigation userRole={userContext?.member?.role ?? 'Member'} />
  );
}

export default function KnowledgeLayout({
  children,
  params,
}: KnowledgeLayoutProps) {
  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Knowledge</h1>
      </div>
      {/* Navigation - streams independently */}
      <Suspense fallback={<NavigationSkeleton items={6} />}>
        <KnowledgeNavigationWrapper params={params} />
      </Suspense>
      {/* Content Area */}
      <ErrorBoundaryWithParams>
        <div className="flex flex-col flex-[1_1_0] px-4 py-6">{children}</div>
      </ErrorBoundaryWithParams>
    </>
  );
}
