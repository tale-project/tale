import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import ApprovalsWrapper from './components/approvals-wrapper';
import { preloadApprovalsData } from './utils/get-approvals-data';
import { DataTableSkeleton } from '@/components/ui/data-table';

interface ApprovalsPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    search?: string;
    page?: string;
  }>;
}

interface ApprovalsContentProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    status?: string;
    search?: string;
    page?: string;
  }>;
}

async function ApprovalsPageContent({
  params,
  searchParams,
}: ApprovalsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { id: organizationId } = await params;
  const { status, search } = (await searchParams) as {
    status?: 'pending' | 'resolved';
    search?: string;
    page?: string;
  };

  if (!status) {
    redirect(`/dashboard/${organizationId}/approvals?status=pending`);
  }

  // Preload approvals for SSR + real-time reactivity on client
  // Search filtering is now done server-side in the Convex query
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
        { header: 'Approval / Recipient' }, // No size = expands to fill remaining space
        { header: 'Event', size: 256 },
        { header: 'Action', size: 256 },
        { header: 'Confidence', size: 100 },
        { header: 'Approved', size: 100 },
      ]}
      showHeader
    />
  );
}

export default function ApprovalsPage({
  params,
  searchParams,
}: ApprovalsPageProps) {
  return (
    <Suspense fallback={<ApprovalsSkeleton />}>
      <ApprovalsPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
