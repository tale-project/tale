'use client';

import { Suspense } from 'react';
import Approvals from './approvals';
import { DataTableSkeleton } from '@/components/ui/data-table';
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
  const columns =
    status === 'resolved'
      ? [
          { header: 'Approval / Recipient', width: 'w-40' },
          { header: 'Event', width: 'w-24' },
          { header: 'Action', width: 'w-24' },
          { header: 'Reviewer', width: 'w-28' },
          { header: 'Reviewed at', width: 'w-28' },
          { header: 'Approved', width: 'w-20' },
        ]
      : [
          { header: 'Approval / Recipient', width: 'w-40' },
          { header: 'Event', width: 'w-24' },
          { header: 'Action', width: 'w-24' },
          { header: 'Confidence', width: 'w-24' },
          { header: 'Approved', width: 'w-20' },
        ];

  return (
    <div className="px-4 py-6">
      <DataTableSkeleton rows={8} columns={columns} showHeader />
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
