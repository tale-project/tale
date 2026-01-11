import { ReactNode } from 'react';
import { KnowledgeNavigation } from './components/knowledge-navigation';
import { LayoutErrorBoundary } from '@/components/error-boundaries';
import { ContentWrapper } from '@/components/layout/content-wrapper';
import { PageHeader, PageHeaderTitle } from '@/components/layout/page-header';
import { StickyHeader } from '@/components/layout/sticky-header';
import { getT } from '@/lib/i18n/server';

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
export default async function KnowledgeLayout({
  children,
  params,
}: KnowledgeLayoutProps) {
  const { id: organizationId } = await params;
  const { t } = await getT('knowledge');

  return (
    <>
      <StickyHeader>
        <PageHeader standalone={false}>
          <PageHeaderTitle>{t('title')}</PageHeaderTitle>
        </PageHeader>
        <KnowledgeNavigation />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="py-6 px-4">{children}</ContentWrapper>
      </LayoutErrorBoundary>
    </>
  );
}
