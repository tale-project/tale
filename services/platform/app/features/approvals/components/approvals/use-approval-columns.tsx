import type { ColumnDef } from '@tanstack/react-table';

import { CheckIcon, Info, Loader2, X } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { CellErrorBoundary } from '@/app/components/error-boundaries/boundaries/cell-error-boundary';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import {
  safeGetString,
  safeGetNumber,
  safeGetArray,
} from '@/lib/utils/safe-parsers';

import { ProductListCell } from './product-list-cell';

type ApprovalItem = Doc<'approvals'>;
type ApprovalsT = ReturnType<typeof useT<'approvals'>>['t'];

interface UseApprovalColumnsParams {
  approving: string | null;
  rejecting: string | null;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}

function createSharedColumns(
  t: ApprovalsT,
  getCustomerLabel: (approval: ApprovalItem) => string,
  getLabel: (resourceType: string) => string,
): ColumnDef<ApprovalItem>[] {
  return [
    {
      id: 'approval',
      header: t('columns.approvalRecipient'),
      size: 256,
      meta: { skeleton: { type: 'avatar-text' as const } },
      cell: ({ row }) => (
        <div className="flex min-h-[41px] flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <Text as="span" variant="label" className="tracking-tight">
              {getLabel(row.original.resourceType)}
            </Text>
            <Info className="text-muted-foreground size-4 shrink-0 grow-0" />
          </div>
          <Text as="div" variant="muted" className="tracking-tight">
            {getCustomerLabel(row.original)}
          </Text>
        </div>
      ),
    },
    {
      id: 'event',
      header: t('columns.event'),
      size: 256,
      meta: { skeleton: { type: 'text' as const } },
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <Text as="div" variant="label-sm">
              {t('labels.purchase')}
            </Text>
            <CellErrorBoundary
              fallback={
                <Text as="span" variant="caption">
                  —
                </Text>
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
      meta: { skeleton: { type: 'text' as const } },
      cell: ({ row }) => {
        const metadata = row.original.metadata ?? {};
        return (
          <div className="flex flex-col gap-1.5">
            <Text as="div" variant="label-sm">
              {t('labels.recommendation')}
            </Text>
            <CellErrorBoundary
              fallback={
                <Text as="span" variant="caption">
                  —
                </Text>
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
  ];
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
        case 'workflow_run':
          return t('types.runWorkflow');
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
      ...createSharedColumns(t, getCustomerLabel, getApprovalTypeLabel),
      {
        id: 'confidence',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {t('columns.confidence')}
          </Text>
        ),
        size: 100,
        meta: { headerLabel: t('columns.confidence') },
        cell: ({ row }) => (
          <Text
            as="span"
            variant="caption"
            align="right"
            className="block font-medium"
          >
            {getConfidencePercent(row.original)}%
          </Text>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <Text as="span" align="center" className="block w-full">
            {t('columns.approved')}
          </Text>
        ),
        size: 100,
        meta: {
          headerLabel: t('columns.approved'),
          skeleton: { type: 'action' as const },
        },
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
      ...createSharedColumns(t, getCustomerLabel, () =>
        t('types.recommendProduct'),
      ),
      {
        id: 'reviewer',
        header: t('columns.reviewer'),
        meta: { skeleton: { type: 'text' as const } },
        cell: ({ row }) => {
          const metadata = row.original.metadata ?? {};
          return (
            <Text as="div" variant="body">
              {safeGetString(metadata, 'approverName', '') ||
                t('columns.unknown')}
            </Text>
          );
        },
      },
      {
        id: 'reviewedAt',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {t('columns.reviewedAt')}
          </Text>
        ),
        meta: { headerLabel: t('columns.reviewedAt') },
        cell: ({ row }) => (
          <Text as="span" variant="body" align="right" className="block">
            {row.original.reviewedAt
              ? formatDate(new Date(row.original.reviewedAt), 'short')
              : ''}
          </Text>
        ),
      },
      {
        id: 'status',
        header: () => (
          <Text as="span" align="right" className="block w-full">
            {t('columns.approved')}
          </Text>
        ),
        size: 100,
        meta: {
          headerLabel: t('columns.approved'),
          skeleton: { type: 'action' as const },
        },
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
