import { ReactNode } from 'react';
import { ConversationsNavigation } from './conversations-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { ContentWrapper } from '@/components/layout/content-wrapper';
import { PageHeader, PageHeaderTitle } from '@/components/layout/page-header';
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
      <PageHeader>
        <PageHeaderTitle>{t('title')}</PageHeaderTitle>
      </PageHeader>
      <ConversationsNavigation organizationId={organizationId} />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
