'use client';

import type { UsePaginatedQueryResult } from 'convex/react';

import { GitCompare } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import {
  useRemoveRecommendedProduct,
  useUpdateApprovalStatus,
} from '../hooks/mutations';
import { ApprovalDetailDialog } from './approval-detail-dialog';
import { getApprovalDetail } from './approvals/get-approval-detail';
import { useApprovalColumns } from './approvals/use-approval-columns';

type ApprovalItem = Doc<'approvals'>;

interface ApprovalsProps {
  status?: 'pending' | 'resolved';
  search?: string;
  paginatedResult: UsePaginatedQueryResult<ApprovalItem>;
  approxCount?: number;
}

export function Approvals({
  status,
  search,
  paginatedResult,
  approxCount,
}: ApprovalsProps) {
  const { t } = useT('approvals');

  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(
    null,
  );
  const [removingProductId, setRemovingProductId] = useState<string | null>(
    null,
  );
  const [approvalDetailDialogOpen, setApprovalDetailDialogOpen] =
    useState(false);
  const pageSize = 30;

  const allApprovals = useMemo(() => {
    if (!search) return paginatedResult.results;
    const lowerSearch = search.toLowerCase();
    return paginatedResult.results.filter((a) => {
      const metadata = a.metadata ?? {};
      const customerName =
        typeof metadata['customerName'] === 'string'
          ? metadata['customerName']
          : '';
      const customerEmail =
        typeof metadata['customerEmail'] === 'string'
          ? metadata['customerEmail']
          : '';
      return (
        customerName.toLowerCase().includes(lowerSearch) ||
        customerEmail.toLowerCase().includes(lowerSearch)
      );
    });
  }, [paginatedResult.results, search]);

  const list = useListPage<ApprovalItem>({
    dataSource: {
      type: 'paginated',
      results: allApprovals,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    getRowId: (row) => row._id,
    approxRowCount: approxCount,
  });

  const { mutateAsync: updateApprovalStatus } = useUpdateApprovalStatus();
  const { mutateAsync: removeRecommendedProduct } =
    useRemoveRecommendedProduct();

  const handleApprove = useCallback(
    async (approvalId: string) => {
      setApproving(approvalId);

      try {
        await updateApprovalStatus({
          approvalId: toId<'approvals'>(approvalId),
          status: 'approved',
          comments: 'Approved via UI',
        });
      } catch (error) {
        console.error('Failed to approve:', error);
        toast({
          title: t('toast.approveFailed'),
          variant: 'destructive',
        });
      } finally {
        setApproving(null);
      }
    },
    [updateApprovalStatus, t],
  );

  const handleReject = useCallback(
    async (approvalId: string) => {
      setRejecting(approvalId);

      try {
        await updateApprovalStatus({
          approvalId: toId<'approvals'>(approvalId),
          status: 'rejected',
          comments: 'Rejected via UI',
        });
      } catch (error) {
        console.error('Failed to reject:', error);
        toast({
          title: t('toast.rejectFailed'),
          variant: 'destructive',
        });
      } finally {
        setRejecting(null);
      }
    },
    [updateApprovalStatus, t],
  );

  const handleRemoveRecommendation = useCallback(
    async (approvalId: string, productId: string) => {
      setRemovingProductId(productId);

      try {
        await removeRecommendedProduct({
          approvalId: toId<'approvals'>(approvalId),
          productId,
        });
      } catch (error) {
        console.error('Failed to remove recommendation:', error);
        toast({
          title: t('toast.removeRecommendationFailed'),
          variant: 'destructive',
        });
      } finally {
        setRemovingProductId(null);
      }
    },
    [removeRecommendedProduct, t],
  );

  const handleApprovalRowClick = useCallback((approvalId: string) => {
    setSelectedApprovalId(approvalId);
    setApprovalDetailDialogOpen(true);
  }, []);

  const handleApprovalDetailOpenChange = useCallback((open: boolean) => {
    setApprovalDetailDialogOpen(open);
    if (!open) {
      setSelectedApprovalId(null);
    }
  }, []);

  const { pendingColumns, resolvedColumns } = useApprovalColumns({
    approving,
    rejecting,
    onApprove: handleApprove,
    onReject: handleReject,
  });

  const selectedApprovalDetail = useMemo(() => {
    if (!selectedApprovalId || !allApprovals) return null;
    const approval = allApprovals.find(
      (a: ApprovalItem) => a._id === selectedApprovalId,
    );
    if (!approval) return null;
    return getApprovalDetail(approval);
  }, [selectedApprovalId, allApprovals]);

  const columns = status === 'pending' ? pendingColumns : resolvedColumns;

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout
        onRowClick={(row) => handleApprovalRowClick(row.original._id)}
        rowClassName="cursor-pointer"
        emptyState={{
          icon: GitCompare,
          title:
            status === 'pending'
              ? t('emptyState.pending.title')
              : t('emptyState.resolved.title'),
          description:
            status === 'pending'
              ? t('emptyState.pending.description')
              : undefined,
        }}
        {...list.tableProps}
      />
      <ApprovalDetailDialog
        open={approvalDetailDialogOpen}
        onOpenChange={handleApprovalDetailOpenChange}
        approvalDetail={selectedApprovalDetail}
        onApprove={handleApprove}
        onReject={handleReject}
        isApproving={approving === selectedApprovalId}
        isRejecting={rejecting === selectedApprovalId}
        onRemoveRecommendation={handleRemoveRecommendation}
        removingProductId={removingProductId}
      />
    </>
  );
}
