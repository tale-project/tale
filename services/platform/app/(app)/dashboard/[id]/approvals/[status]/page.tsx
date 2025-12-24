import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import ApprovalsWrapper from '../components/approvals-wrapper';
import { preloadApprovalsData } from '../utils/get-approvals-data';
import {
  DataTableSkeleton,
  DataTableEmptyState,
} from '@/components/ui/data-table';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';
import { GitCompare } from 'lucide-react';

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
function ApprovalsSkeleton() {
  return (
    <DataTableSkeleton
      rows={8}
      columns={[
        { header: 'Approval / Recipient' },
        { header: 'Event', size: 256 },
        { header: 'Action', size: 256 },
        { header: 'Confidence', size: 100 },
        { header: 'Approved', size: 100 },
      ]}
      showHeader
    />
  );
}

/** Empty state shown when org has no approvals - avoids unnecessary skeleton */
function ApprovalsEmptyState({ status }: { status: string }) {
  return (
    <DataTableEmptyState
      icon={GitCompare}
      title={`No ${status} approvals`}
      description={
        status === 'pending'
          ? 'When human input is needed, your AI will request it here'
          : undefined
      }
    />
  );
}

export default async function ApprovalsStatusPage({
  params,
  searchParams,
}: ApprovalsPageProps) {
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

// Enable static generation for all valid status pages
export function generateStaticParams() {
  return VALID_STATUSES.map((status) => ({ status }));
}
