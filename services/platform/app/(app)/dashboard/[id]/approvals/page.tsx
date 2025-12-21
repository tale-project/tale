import { SuspenseLoader } from '@/components/suspense-loader';
import { redirect } from 'next/navigation';
import ApprovalsWrapper from './components/approvals-wrapper';
import { preloadApprovalsData } from './utils/get-approvals-data';

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

export default function ApprovalsPage({
  params,
  searchParams,
}: ApprovalsPageProps) {
  return (
    <SuspenseLoader>
      <ApprovalsPageContent params={params} searchParams={searchParams} />
    </SuspenseLoader>
  );
}
