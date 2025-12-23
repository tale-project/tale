import { ReactNode } from 'react';
import KnowledgeNavigation from './knowledge-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface KnowledgeLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Knowledge Layout - Server Component
 *
 * The navigation is rendered directly without Suspense since:
 * 1. All navigation items are accessible to all roles (no role-based filtering)
 * 2. The navigation component only needs the organizationId from params
 * 3. This eliminates skeleton flash and provides instant navigation
 */
export default function KnowledgeLayout({ children }: KnowledgeLayoutProps) {
  return (
    <>
      <div className="px-4 py-2 sticky top-0 z-50 bg-background/50 backdrop-blur-md min-h-12 flex items-center">
        <h1 className="text-base font-semibold text-foreground">Knowledge</h1>
      </div>
      {/* Navigation - rendered directly, no skeleton needed */}
      <KnowledgeNavigation />
      {/* Content Area */}
      <ErrorBoundaryWithParams>
        <div className="flex flex-col flex-[1_1_0] px-4 py-6">{children}</div>
      </ErrorBoundaryWithParams>
    </>
  );
}
