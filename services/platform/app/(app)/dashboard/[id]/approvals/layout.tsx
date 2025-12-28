import { ReactNode } from 'react';
import { connection } from 'next/server';
import ApprovalsNavigation from './approvals-navigation';
import {
  ContentWrapper,
  PageHeader,
  PageHeaderTitle,
} from '@/components/layout';
import { ErrorBoundaryWithParams } from '@/components/error-boundary';
import { getT } from '@/lib/i18n/server';

interface ApprovalsLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ApprovalsLayout({
  children,
  params,
}: ApprovalsLayoutProps) {
  await connection();
  const { id: organizationId } = await params;
  const { t } = await getT('approvals');

  return (
    <>
      <PageHeader>
        <PageHeaderTitle>{t('title')}</PageHeaderTitle>
      </PageHeader>
      <ApprovalsNavigation organizationId={organizationId} />
      <ErrorBoundaryWithParams>
        <ContentWrapper>{children}</ContentWrapper>
      </ErrorBoundaryWithParams>
    </>
  );
}
