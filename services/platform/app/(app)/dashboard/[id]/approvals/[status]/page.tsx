import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ApprovalsWrapper } from '../components/approvals-wrapper';
import { preloadApprovalsData } from '../utils/get-approvals-data';
import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';
import { ApprovalsEmptyState } from '../components/approvals-empty-state';

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { t } = await getT('metadata');
  return {
    title: t('approvals.title'),
    description: t('approvals.description'),
  };
}

const VALID_STATUSES = ['pending', 'resolved'] as const;
type ApprovalStatus = (typeof VALID_STATUSES)[number];

function isValidApprovalStatus(s: string): s is ApprovalStatus {
  return VALID_STATUSES.includes(s as ApprovalStatus);
}

interface ApprovalsPageProps {
  params: Promise<{ id: string; status: string }>;
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
}

interface ApprovalsContentProps {
  params: Promise<{ id: string; status: string }>;
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
}

async function ApprovalsPageContent({
  params,
  searchParams,
}: ApprovalsContentProps) {
  const { id: organizationId, status } = await params;
  const { search } = await searchParams;

  // Validate status parameter
  if (!isValidApprovalStatus(status)) {
    notFound();
  }

  // Preload approvals for SSR + real-time reactivity on client
  const preloadedApprovals = await preloadApprovalsData({
    organizationId,
    status,
    search,
  });

  return (
    <ApprovalsWrapper
      key={`${status}-${search}`}
      status={status}
      organizationId={organizationId}
      preloadedApprovals={preloadedApprovals}
    />
  );
}

/** Skeleton for the approvals table - matches approvals.tsx column sizes */
async function ApprovalsSkeleton() {
  const { t } = await getT('approvals');
  return (
    <DataTableSkeleton
      rows={8}
      columns={[
        { header: t('columns.approvalRecipient') },
        { header: t('columns.event'), size: 256 },
        { header: t('columns.action'), size: 256 },
        { header: t('columns.confidence'), size: 100 },
        { header: t('columns.approved'), size: 100 },
      ]}
      showHeader
    />
  );
}


export default async function ApprovalsStatusPage({
  params,
  searchParams,
}: ApprovalsPageProps) {
  await connection();
  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  const { id: organizationId, status } = await params;
  const { search } = await searchParams;

  // Validate status parameter
  if (!isValidApprovalStatus(status)) {
    notFound();
  }

  // Two-phase loading: check if approvals exist before showing skeleton
  // If no approvals and no search query, show empty state directly
  if (!search?.trim()) {
    const hasApprovals = await fetchQuery(
      api.approvals.hasApprovals,
      { organizationId },
      { token },
    );

    if (!hasApprovals) {
      return <ApprovalsEmptyState status={status} />;
    }
  }

  return (
    <Suspense fallback={<ApprovalsSkeleton />}>
      <ApprovalsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

