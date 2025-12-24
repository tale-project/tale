import { ReactNode } from 'react';
import ApprovalsNavigation from './approvals-navigation';
import {
  ContentWrapper,
  PageHeader,
  PageHeaderTitle,
} from '@/components/layout';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';

interface ApprovalsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ApprovalsLayout({
  children,
  params,
}: ApprovalsLayoutProps) {
  const { id: organizationId } = await params;

  return (
    <>
      <PageHeader>
        <PageHeaderTitle>Approvals</PageHeaderTitle>
      </PageHeader>
      <ApprovalsNavigation organizationId={organizationId} />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
