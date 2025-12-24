import { ReactNode } from 'react';
import KnowledgeNavigation from './knowledge-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import {
  ContentWrapper,
  PageHeader,
  PageHeaderTitle,
} from '@/components/layout';

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
      <PageHeader>
        <PageHeaderTitle>Knowledge</PageHeaderTitle>
      </PageHeader>
      <KnowledgeNavigation />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
