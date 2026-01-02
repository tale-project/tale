import { ReactNode } from 'react';
import { ConversationsNavigation } from './conversations-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
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
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
