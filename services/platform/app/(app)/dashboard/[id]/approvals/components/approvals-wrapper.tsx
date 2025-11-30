import { Suspense } from 'react';
import Approvals from './approvals';
import { getApprovalsData } from '../utils/get-approvals-data';

interface ApprovalsWrapperProps {
  organizationId: string;
  status?: 'pending' | 'resolved';
  search?: string;
  page: number;
}

function ApprovalsLoader() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="animate-spin rounded-full size-8 border-b-2 border-foreground"></div>
      <p className="text-sm text-muted-foreground">Loading approvals...</p>
    </div>
  );
}

async function ApprovalsContent({
  organizationId,
  status,
  search,
  page,
}: ApprovalsWrapperProps) {
  const approvalsData = await getApprovalsData({
    organizationId,
    status,
    search,
    page,
  });
  return (
    <Approvals
      initialApprovals={approvalsData.approvals}
      status={status}
      organizationId={organizationId}
      search={search}
    />
  );
}

export default function ApprovalsWrapper({
  organizationId,
  status,
  search,
  page,
}: ApprovalsWrapperProps) {
  return (
    <Suspense fallback={<ApprovalsLoader />}>
      <ApprovalsContent
        organizationId={organizationId}
        status={status}
        search={search}
        page={page}
      />
    </Suspense>
  );
}
