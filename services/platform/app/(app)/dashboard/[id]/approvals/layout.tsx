import { ReactNode } from 'react';
import { connection } from 'next/server';
import { ApprovalsNavigation } from './components/approvals-navigation';
import { ContentWrapper } from '@/components/layout/content-wrapper';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/components/layout/adaptive-header';
import { StickyHeader } from '@/components/layout/sticky-header';
import { LayoutErrorBoundary } from '@/components/error-boundaries/boundaries/layout-error-boundary';
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
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <ApprovalsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="px-4 py-6">{children}</ContentWrapper>
      </LayoutErrorBoundary>
    </>
  );
}
