import { ReactNode } from 'react';
import { ConversationsNavigation } from './components/conversations-navigation';
import { LayoutErrorBoundary } from '@/components/error-boundaries';
import { ContentWrapper } from '@/components/layout/content-wrapper';
import { PageHeader, PageHeaderTitle } from '@/components/layout/page-header';
import { StickyHeader } from '@/components/layout/sticky-header';
import { getT } from '@/lib/i18n/server';

interface ConversationsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ConversationsLayout({
  children,
  params,
}: ConversationsLayoutProps) {
  const { id: organizationId } = await params;
  const { t } = await getT('conversations');

  return (
    <>
      <StickyHeader>
        <PageHeader standalone={false}>
          <PageHeaderTitle>{t('title')}</PageHeaderTitle>
        </PageHeader>
        <ConversationsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="flex flex-row size-full flex-1 max-h-full">
          {children}
        </ContentWrapper>
      </LayoutErrorBoundary>
    </>
  );
}
