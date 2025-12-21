'use client';

import { Suspense } from 'react';
import Approvals from './approvals';
import { TableSkeleton } from '@/components/skeletons';
import type { PreloadedApprovals } from '../utils/get-approvals-data';

interface ApprovalsWrapperProps {
  status?: 'pending' | 'resolved';
  organizationId: string;
  preloadedApprovals: PreloadedApprovals;
}

/**
 * Skeleton for the approvals table that matches the actual layout.
 * Shows different columns based on pending vs resolved status.
 */
function ApprovalsSkeleton({ status }: { status?: 'pending' | 'resolved' }) {
  const headers =
    status === 'resolved'
      ? [
          'Approval / Recipient',
          'Event',
          'Action',
          'Reviewer',
          'Reviewed at',
          'Approved',
        ]
      : ['Approval / Recipient', 'Event', 'Action', 'Confidence', 'Approved'];

  return (
    <div className="px-4 py-6">
      <TableSkeleton rows={8} headers={headers} />
    </div>
  );
}

export default function ApprovalsWrapper({
  status,
  organizationId,
  preloadedApprovals,
}: ApprovalsWrapperProps) {
  return (
    <Suspense fallback={<ApprovalsSkeleton status={status} />}>
      <Approvals
        status={status}
        organizationId={organizationId}
        preloadedApprovals={preloadedApprovals}
      />
    </Suspense>
  );
}
