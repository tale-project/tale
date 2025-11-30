'use client';

import { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import KnowledgeNavigation from './knowledge-navigation';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface KnowledgeLayoutProps {
  children: ReactNode;
}

export default function KnowledgeLayout({ children }: KnowledgeLayoutProps) {
  const params = useParams();
  const userContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: params.id as string,
  });

  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-10 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Knowledge</h1>
      </div>
      {/* Navigation  */}
      <KnowledgeNavigation userRole={userContext?.member?.role ?? 'Member'} />
      {/* Content Area */}
      <ErrorBoundaryWithParams>
        <div className="flex flex-col flex-[1_1_0] px-4 py-6">{children}</div>
      </ErrorBoundaryWithParams>
    </>
  );
}
