import type { ColumnDef } from '@tanstack/react-table';

import { CheckIcon, Info, Loader2, X } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { CellErrorBoundary } from '@/app/components/error-boundaries/boundaries/cell-error-boundary';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import {
  safeGetString,
  safeGetNumber,
  safeGetArray,
} from '@/lib/utils/safe-parsers';

import { ProductListCell } from './product-list-cell';

type ApprovalItem = Doc<'approvals'>;

interface UseApprovalColumnsParams {
  approving: string | null;
  rejecting: string | null;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}

export function useApprovalColumns({
  approving,
  rejecting,
  onApprove,
  onReject,
}: UseApprovalColumnsParams) {
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

  const pendingColumns = useMemo(
    (): ColumnDef<ApprovalItem>[] => [
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
                <ProductListCell
                  products={safeGetArray(metadata, 'eventProducts', [])}
                />
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
                <ProductListCell
                  products={safeGetArray(metadata, 'recommendedProducts', [])}
                  isRecommendation
                />
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
                onApprove(row.original._id);
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
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onReject(row.original._id);
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
    ],
    [
      t,
      getApprovalTypeLabel,
      getCustomerLabel,
      getConfidencePercent,
      approving,
      rejecting,
      onApprove,
      onReject,
    ],
  );

  const resolvedColumns = useMemo(
    (): ColumnDef<ApprovalItem>[] => [
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
                <ProductListCell
                  products={safeGetArray(metadata, 'eventProducts', [])}
                />
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
                <ProductListCell
                  products={safeGetArray(metadata, 'recommendedProducts', [])}
                  isRecommendation
                />
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
          <span className="block w-full text-right">
            {t('columns.approved')}
          </span>
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
    ],
    [t, getCustomerLabel, formatDate],
  );

  return { pendingColumns, resolvedColumns };
}
