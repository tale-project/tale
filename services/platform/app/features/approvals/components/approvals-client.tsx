'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { useQuery } from 'convex/react';
import { CheckIcon, GitCompare, Info, Loader2, X } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { CellErrorBoundary } from '@/app/components/error-boundaries/boundaries/cell-error-boundary';
import { Image } from '@/app/components/ui/data-display/image';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useListPage } from '@/app/hooks/use-list-page';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  safeGetString,
  safeGetNumber,
  safeGetArray,
} from '@/lib/utils/safe-parsers';

import { useRemoveRecommendedProduct } from '../hooks/use-remove-recommended-product';
import { useUpdateApprovalStatus } from '../hooks/use-update-approval-status';
import { ApprovalDetail } from '../types/approval-detail';
import { ApprovalDetailDialog } from './approval-detail-dialog';

type ApprovalItem = {
  _id: string;
  _creationTime: number;
  organizationId: string;
  wfExecutionId?: string;
  stepSlug?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  reviewedAt?: number;
  resourceType: string;
  resourceId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: number;
  executedAt?: number;
  executionError?: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
  messageId?: string;
};

interface ApprovalsClientProps {
  status?: 'pending' | 'resolved';
  organizationId: string;
  search?: string;
}

function ApprovalsSkeleton({ status }: { status?: 'pending' | 'resolved' }) {
  const { t } = useT('approvals');
  const columns =
    status === 'resolved'
      ? [
          { header: t('columns.approvalRecipient'), size: 256 },
          { header: t('columns.event'), size: 256 },
          { header: t('columns.action'), size: 256 },
          { header: t('columns.reviewer') },
          { header: t('columns.reviewedAt') },
          { header: t('columns.approved'), size: 100 },
        ]
      : [
          { header: t('columns.approvalRecipient'), size: 256 },
          { header: t('columns.event'), size: 256 },
          { header: t('columns.action'), size: 256 },
          { header: t('columns.confidence'), size: 100 },
          { header: t('columns.approved'), size: 100 },
        ];

  return (
    <DataTableSkeleton
      rows={8}
      columns={columns}
      showHeader
      stickyLayout
      infiniteScroll
    />
  );
}

export function ApprovalsClient({
  status,
  organizationId,
  search,
}: ApprovalsClientProps) {
  const { t } = useT('approvals');
  const { formatDate } = useFormatDate();

  const getApprovalTypeLabel = useCallback(
    (resourceType: string): string => {
      switch (resourceType) {
        case 'conversations':
          return t('types.reviewReply');
        case 'product_recommendation':
          return t('types.recommendProduct');
        default:
          return t('types.review');
      }
    },
    [t],
  );

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
  const pageSize = 10;

  const approvalsResult = useQuery(
    api.approvals.queries.listApprovalsByOrganization,
    {
      organizationId,
      status: status === 'pending' ? 'pending' : undefined,
      resourceType: ['product_recommendation'],
      search: search || undefined,
      limit: 200,
    },
  );

  const allApprovals = useMemo(() => approvalsResult ?? [], [approvalsResult]);

  const list = useListPage<ApprovalItem>({
    dataSource: {
      type: 'query',
      data: approvalsResult === undefined ? undefined : allApprovals,
    },
    pageSize,
    getRowId: (row) => row._id,
  });

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });

  const updateApprovalStatus = useUpdateApprovalStatus();
  const removeRecommendedProduct = useRemoveRecommendedProduct();

  const handleApprove = useCallback(
    async (approvalId: string) => {
      if (!memberContext?.memberId) {
        toast({
          title: t('toast.loginRequired'),
          variant: 'destructive',
        });
        return;
      }

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
    [memberContext?.memberId, updateApprovalStatus, t],
  );

  const handleReject = useCallback(
    async (approvalId: string) => {
      if (!memberContext?.memberId) {
        toast({
          title: t('toast.loginRequired'),
          variant: 'destructive',
        });
        return;
      }

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
    [memberContext?.memberId, updateApprovalStatus, t],
  );

  const handleRemoveRecommendation = useCallback(
    async (approvalId: string, productId: string) => {
      if (!memberContext?.memberId) {
        toast({
          title: t('toast.loginRequired'),
          variant: 'destructive',
        });
        return;
      }

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
    [memberContext?.memberId, removeRecommendedProduct, t],
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

  const getApprovalDetail = useCallback(
    (approvalId: string): ApprovalDetail | null => {
      if (!allApprovals) return null;
      const approval = allApprovals.find(
        (a: ApprovalItem) => a._id === approvalId,
      );
      if (!approval) return null;

      const metadata: Record<string, unknown> = approval.metadata ?? {};

      const recommendedProducts = safeGetArray(
        metadata,
        'recommendedProducts',
        [],
      ).map((product, index: number) => {
        const id = safeGetString(product, 'productId', `rec-${index}`);
        const name = safeGetString(product, 'productName', '');
        const image = safeGetString(
          product,
          'imageUrl',
          '/assets/placeholder-image.png',
        );
        const relationshipType = safeGetString(
          product,
          'relationshipType',
          undefined,
        );
        const reasoning = safeGetString(product, 'reasoning', undefined);
        const confidence = safeGetNumber(product, 'confidence', undefined);
        return { id, name, image, relationshipType, reasoning, confidence };
      });

      const previousPurchases = safeGetArray(metadata, 'eventProducts', []).map(
        (product, index: number) => {
          const id = safeGetString(product, 'id', `prev-${index}`);
          const productName =
            safeGetString(product, 'productName', '') ||
            safeGetString(product, 'name', '') ||
            safeGetString(product, 'product_name', '');
          const image =
            safeGetString(product, 'image', '') ||
            safeGetString(product, 'imageUrl', '') ||
            safeGetString(product, 'image_url', '') ||
            '/assets/placeholder-image.png';
          const purchaseDate = safeGetString(
            product,
            'purchaseDate',
            undefined,
          );
          const statusValue = safeGetString(product, 'status', undefined);
          const purchaseStatus: 'active' | 'cancelled' | undefined =
            statusValue === 'active' || statusValue === 'cancelled'
              ? statusValue
              : undefined;
          return {
            id,
            productName,
            image,
            purchaseDate,
            status: purchaseStatus,
          };
        },
      );

      const metaConfidence = (() => {
        const raw =
          typeof metadata['confidence'] === 'number'
            ? metadata['confidence']
            : undefined;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
        return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
      })();

      const customerId = safeGetString(metadata, 'customerId', undefined);

      return {
        _id: approval._id,
        organizationId: approval.organizationId,
        customer: {
          id: customerId ? toId<'customers'>(customerId) : undefined,
          name:
            typeof metadata['customerName'] === 'string'
              ? metadata['customerName'].trim()
              : '',
          email:
            typeof metadata['customerEmail'] === 'string'
              ? metadata['customerEmail']
              : '',
        },
        resourceType: approval.resourceType,
        status: approval.status,
        priority: approval.priority,
        confidence: metaConfidence,
        createdAt: approval._creationTime,
        reviewer: safeGetString(metadata, 'approverName', undefined),
        reviewedAt: approval.reviewedAt,
        decidedAt: approval.reviewedAt,
        comments: safeGetString(metadata, 'comments', undefined),
        recommendedProducts,
        previousPurchases,
      };
    },
    [allApprovals],
  );

  const renderProductList = useCallback(
    (products: unknown, isRecommendation = false) => {
      const list = Array.isArray(products) ? products : [];
      if (list.length === 0) return null;

      if (isRecommendation) {
        const sortedList = [...list].sort((a, b) => {
          const confA = safeGetNumber(a, 'confidence', 0) ?? 0;
          const confB = safeGetNumber(b, 'confidence', 0) ?? 0;
          return confB - confA;
        });

        const firstProduct = sortedList[0];
        const remainingCount = sortedList.length - 1;
        const secondProduct = sortedList[1];

        const firstName =
          safeGetString(firstProduct, 'name', '') ||
          safeGetString(firstProduct, 'productName', '');
        const firstImage =
          safeGetString(firstProduct, 'image', '') ||
          safeGetString(firstProduct, 'imageUrl', '') ||
          '/assets/placeholder-image.png';

        return (
          <Stack gap={1}>
            <HStack gap={2}>
              <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
                <Image
                  src={firstImage}
                  alt={firstName}
                  width={20}
                  height={20}
                  className="h-full w-full object-cover"
                />
              </div>
              <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
                {firstName}
              </span>
            </HStack>
            {remainingCount > 0 && secondProduct && (
              <HStack gap={2}>
                <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
                  <Image
                    src={
                      safeGetString(secondProduct, 'image', '') ||
                      safeGetString(secondProduct, 'imageUrl', '') ||
                      '/assets/placeholder-image.png'
                    }
                    alt={
                      safeGetString(secondProduct, 'name', '') ||
                      safeGetString(secondProduct, 'productName', '')
                    }
                    width={20}
                    height={20}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
                  {t('labels.otherProducts', { count: remainingCount })}
                </span>
              </HStack>
            )}
          </Stack>
        );
      }

      return (
        <Stack gap={1}>
          {list.map((p, index) => {
            const id =
              safeGetString(p, 'productId', '') ||
              safeGetString(p, 'id', '') ||
              String(index);
            const name =
              safeGetString(p, 'name', '') ||
              safeGetString(p, 'productName', '');
            const image =
              safeGetString(p, 'image', '') ||
              safeGetString(p, 'imageUrl', '') ||
              '/assets/placeholder-image.png';

            return (
              <HStack key={id} gap={2}>
                <div className="bg-muted size-5 flex-shrink-0 overflow-hidden rounded">
                  <Image
                    src={image}
                    alt={name}
                    width={20}
                    height={20}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="text-muted-foreground text-xs leading-normal font-normal whitespace-nowrap">
                  {name}
                </span>
              </HStack>
            );
          })}
        </Stack>
      );
    },
    [t],
  );

  const getCustomerLabel = useCallback(
    (approval: ApprovalItem) => {
      const metadata = approval.metadata ?? {};
      return (
        safeGetString(metadata, 'customerName', '').trim() ||
        safeGetString(metadata, 'customerEmail', '').trim() ||
        t('columns.unknownCustomer')
      );
    },
    [t],
  );

  const getConfidencePercent = useCallback((approval: ApprovalItem) => {
    const metadata = approval.metadata ?? {};
    const recs = safeGetArray(metadata, 'recommendedProducts', []);
    const firstConf =
      recs.length > 0 ? safeGetNumber(recs[0], 'confidence', 0) : 0;
    const raw = safeGetNumber(metadata, 'confidence', firstConf);
    const n = Number(raw);
    return !Number.isFinite(n)
      ? 0
      : n <= 1
        ? Math.round(n * 100)
        : Math.round(n);
  }, []);

  if (approvalsResult === undefined) {
    return <ApprovalsSkeleton status={status} />;
  }

  const pendingColumns: ColumnDef<ApprovalItem>[] = [
    {
      id: 'approval',
      header: t('columns.approvalRecipient'),
      size: 256,
      cell: ({ row }) => (
        <div className="flex min-h-[41px] flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <span className="text-foreground text-sm font-medium tracking-tight">
              {getApprovalTypeLabel(row.original.resourceType)}
            </span>
            <Info className="text-muted-foreground size-4 flex-shrink-0 flex-grow-0" />
          </div>
          <div className="text-muted-foreground text-sm font-normal tracking-tight">
            {getCustomerLabel(row.original)}
          </div>
        </div>
      ),
    },
    {
      id: 'event',
      header: t('columns.event'),
      size: 256,
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <div className="text-foreground text-xs font-medium">
              {t('labels.purchase')}
            </div>
            <CellErrorBoundary
              fallback={
                <span className="text-muted-foreground text-xs">—</span>
              }
            >
              {renderProductList(safeGetArray(metadata, 'eventProducts', []))}
            </CellErrorBoundary>
          </div>
        );
      },
    },
    {
      id: 'action',
      header: t('columns.action'),
      size: 256,
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <div className="text-foreground text-xs font-medium">
              {t('labels.recommendation')}
            </div>
            <CellErrorBoundary
              fallback={
                <span className="text-muted-foreground text-xs">—</span>
              }
            >
              {renderProductList(
                safeGetArray(metadata, 'recommendedProducts', []),
                true,
              )}
            </CellErrorBoundary>
          </div>
        );
      },
    },
    {
      id: 'confidence',
      header: () => (
        <span className="block w-full text-right">
          {t('columns.confidence')}
        </span>
      ),
      size: 100,
      cell: ({ row }) => (
        <span className="text-muted-foreground block text-right text-xs font-medium">
          {getConfidencePercent(row.original)}%
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="block w-full text-center">
          {t('columns.approved')}
        </span>
      ),
      size: 100,
      cell: ({ row }) => (
        <div className="flex justify-center gap-1">
          <Button
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              void handleApprove(row.original._id);
            }}
            disabled={
              approving === row.original._id || rejecting === row.original._id
            }
            aria-label={t('actions.approve')}
          >
            {approving === row.original._id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckIcon className="size-4" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              void handleReject(row.original._id);
            }}
            disabled={
              approving === row.original._id || rejecting === row.original._id
            }
            aria-label={t('actions.reject')}
          >
            {rejecting === row.original._id ? (
              <div className="border-foreground size-3 animate-spin rounded-full border-b" />
            ) : (
              <X className="text-foreground size-4" />
            )}
          </Button>
        </div>
      ),
    },
  ];

  const resolvedColumns: ColumnDef<ApprovalItem>[] = [
    {
      id: 'approval',
      header: t('columns.approvalRecipient'),
      size: 256,
      cell: ({ row }) => (
        <div className="flex min-h-[41px] flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <span className="text-foreground text-sm font-medium tracking-tight">
              {t('types.recommendProduct')}
            </span>
            <Info className="text-muted-foreground size-4 flex-shrink-0 flex-grow-0" />
          </div>
          <div className="text-muted-foreground text-sm font-normal tracking-tight">
            {getCustomerLabel(row.original)}
          </div>
        </div>
      ),
    },
    {
      id: 'event',
      header: t('columns.event'),
      size: 256,
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <div className="text-foreground text-xs font-medium">
              {t('labels.purchase')}
            </div>
            <CellErrorBoundary
              fallback={
                <span className="text-muted-foreground text-xs">—</span>
              }
            >
              {renderProductList(safeGetArray(metadata, 'eventProducts', []))}
            </CellErrorBoundary>
          </div>
        );
      },
    },
    {
      id: 'action',
      header: t('columns.action'),
      size: 256,
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <div className="text-foreground text-xs font-medium">
              {t('labels.recommendation')}
            </div>
            <CellErrorBoundary
              fallback={
                <span className="text-muted-foreground text-xs">—</span>
              }
            >
              {renderProductList(
                safeGetArray(metadata, 'recommendedProducts', []),
                true,
              )}
            </CellErrorBoundary>
          </div>
        );
      },
    },
    {
      id: 'reviewer',
      header: t('columns.reviewer'),
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="text-sm">
            {safeGetString(metadata, 'approverName', '') ||
              t('columns.unknown')}
          </div>
        );
      },
    },
    {
      id: 'reviewedAt',
      header: () => (
        <span className="block w-full text-right">
          {t('columns.reviewedAt')}
        </span>
      ),
      cell: ({ row }) => (
        <span className="block text-right text-sm">
          {row.original.reviewedAt
            ? formatDate(new Date(row.original.reviewedAt), 'short')
            : ''}
        </span>
      ),
    },
    {
      id: 'status',
      header: () => (
        <span className="block w-full text-right">{t('columns.approved')}</span>
      ),
      size: 100,
      cell: ({ row }) => (
        <div className="px-4 text-center">
          {row.original.status === 'approved' ? (
            <CheckIcon className="inline-block size-4 text-green-600" />
          ) : (
            <X className="inline-block size-4 text-red-600" />
          )}
        </div>
      ),
    },
  ];

  if (allApprovals.length === 0) {
    return (
      <DataTableEmptyState
        icon={GitCompare}
        title={
          status === 'pending'
            ? t('emptyState.pending.title')
            : t('emptyState.resolved.title')
        }
        description={
          status === 'pending' ? t('emptyState.pending.description') : undefined
        }
      />
    );
  }

  const columns = status === 'pending' ? pendingColumns : resolvedColumns;

  return (
    <>
      <DataTable
        columns={columns}
        stickyLayout
        onRowClick={(row) => handleApprovalRowClick(row.original._id)}
        rowClassName="cursor-pointer"
        {...list.tableProps}
      />
      <ApprovalDetailDialog
        open={approvalDetailDialogOpen}
        onOpenChange={handleApprovalDetailOpenChange}
        approvalDetail={
          selectedApprovalId ? getApprovalDetail(selectedApprovalId) : null
        }
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
