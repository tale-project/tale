'use client';

import { Suspense } from 'react';
import Approvals from './approvals';
import { DataTableSkeleton } from '@/components/ui/data-table';
import type { PreloadedApprovals } from '../utils/get-approvals-data';
import { useT } from '@/lib/i18n';

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
  const { t } = useT('approvals');
  const columns =
    status === 'resolved'
      ? [
          { header: t('columns.approvalRecipient') }, // No size = expands to fill remaining space
          { header: t('columns.event'), size: 256 },
          { header: t('columns.action'), size: 256 },
          { header: t('columns.reviewer') },
          { header: t('columns.reviewedAt') },
          { header: t('columns.approved'), size: 100 },
        ]
      : [
          { header: t('columns.approvalRecipient') }, // No size = expands to fill remaining space
          { header: t('columns.event'), size: 256 },
          { header: t('columns.action'), size: 256 },
          { header: t('columns.confidence'), size: 100 },
          { header: t('columns.approved'), size: 100 },
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
