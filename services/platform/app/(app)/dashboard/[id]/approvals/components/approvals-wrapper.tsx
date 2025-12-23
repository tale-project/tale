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
 * Matches approvals.tsx column sizes.
 */
function ApprovalsSkeleton({ status }: { status?: 'pending' | 'resolved' }) {
  const columns =
    status === 'resolved'
      ? [
          { header: 'Approval / Recipient' }, // No size = expands to fill remaining space
          { header: 'Event', size: 256 },
          { header: 'Action', size: 256 },
          { header: 'Reviewer' },
          { header: 'Reviewed at' },
          { header: 'Approved', size: 100 },
        ]
      : [
          { header: 'Approval / Recipient' }, // No size = expands to fill remaining space
          { header: 'Event', size: 256 },
          { header: 'Action', size: 256 },
          { header: 'Confidence', size: 100 },
          { header: 'Approved', size: 100 },
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
