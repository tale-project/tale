import { ReactNode } from 'react';
import ConversationsNavigation from './conversations-navigation';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import {
  ContentWrapper,
  PageHeader,
  PageHeaderTitle,
} from '@/components/layout';

interface ConversationsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ConversationsLayout({
  children,
  params,
}: ConversationsLayoutProps) {
  const { id: organizationId } = await params;

  return (
    <>
      <PageHeader>
        <PageHeaderTitle>Conversations</PageHeaderTitle>
      </PageHeader>
      <ConversationsNavigation organizationId={organizationId} />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
