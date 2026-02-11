'use client';

import { useLiveQuery } from '@tanstack/react-db';
import { Sparkles } from 'lucide-react';
import { useState, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { CustomerInfoDialog } from '@/app/features/customers/components/customer-info-dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { createCustomersCollection } from '@/lib/collections/entities/customers';
import { useCollection } from '@/lib/collections/use-collection';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ApprovalDetail } from '../types/approval-detail';
import { ProductCard } from './product-card';

const RecommendationIcon = () => (
  <Sparkles className="text-muted-foreground size-4" />
);

interface ApprovalDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approvalDetail: ApprovalDetail | null;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  onRemoveRecommendation?: (approvalId: string, productId: string) => void;
  removingProductId?: string | null;
}

export function ApprovalDetailDialog({
  open,
  onOpenChange,
  approvalDetail,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
  onRemoveRecommendation,
  removingProductId,
}: ApprovalDetailDialogProps) {
  const { t } = useT('approvals');
  const { formatDate } = useFormatDate();
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);

  // Lookup customer by email from collection
  const customersCollection = useCollection(
    'customers',
    createCustomersCollection,
    approvalDetail?.organizationId ?? '',
  );
  const customerEmail = approvalDetail?.customer.email;
  const { data: customerDocs } = useLiveQuery(
    (q) =>
      q
        .from({ c: customersCollection })
        .fn.where((row) => row.c.email === customerEmail)
        .select(({ c }) => c),
    [customerEmail],
  );
  const customerRecord = useMemo(
    () => customerDocs?.[0] ?? null,
    [customerDocs],
  );

  // Sort products by confidence (high to low) and get first product
  const sortedProducts = useMemo(() => {
    if (!approvalDetail) return [];
    return [...approvalDetail.recommendedProducts].sort((a, b) => {
      const confA = a.confidence ?? 0;
      const confB = b.confidence ?? 0;
      return confB - confA;
    });
  }, [approvalDetail]);

  if (!approvalDetail) return null;

  const handleRemoveRecommendation = (productId: string) => {
    if (!onRemoveRecommendation) return;
    onRemoveRecommendation(approvalDetail._id, productId);
  };

  const visibleProducts = sortedProducts.slice(0, 3);

  const footer =
    approvalDetail.status === 'pending' ? (
      <div className="flex w-full gap-3">
        <Button
          onClick={() => onReject?.(approvalDetail._id)}
          disabled={isApproving || isRejecting}
          variant="outline"
          className="flex-1"
        >
          {t('detail.reject')}
        </Button>
        <Button
          onClick={() => onApprove?.(approvalDetail._id)}
          disabled={isApproving || isRejecting}
          className="flex-1"
        >
          {t('detail.approve')}
        </Button>
      </div>
    ) : undefined;

  return (
    <>
      <Dialog
        open={open}
        size="md"
        onOpenChange={onOpenChange}
        title={t('detail.title')}
        className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:p-0"
        footer={footer}
        footerClassName="p-4 border-t border-border bg-background"
        customHeader={
          <div className="border-border border-b px-4 py-6">
            <h2 className="text-foreground text-base leading-none font-semibold tracking-tight">
              {t('detail.title')}
            </h2>
          </div>
        }
      >
        {/* Content */}
        <Stack
          gap={10}
          className={cn(
            'p-4 max-h-[calc(100%-88px)] overflow-y-auto',
            approvalDetail.status === 'pending' && 'pb-4',
          )}
        >
          {/* Customer Info */}
          <Stack gap={8}>
            <Stack gap={1}>
              <h3 className="text-foreground text-base font-medium">
                {approvalDetail.customer.name}
              </h3>
              <p className="text-muted-foreground text-sm">
                {approvalDetail.customer.email}
              </p>
            </Stack>

            {/* Approval Details */}
            <Stack gap={3}>
              {/* Status */}
              <HStack>
                <div className="text-muted-foreground w-[90px] text-xs">
                  {t('detail.status')}
                </div>
                <Badge
                  dot
                  variant={
                    (approvalDetail.status === 'pending' && 'orange') ||
                    (approvalDetail.status === 'approved' && 'green') ||
                    (approvalDetail.status === 'rejected' && 'destructive') ||
                    'outline'
                  }
                >
                  {(approvalDetail.status === 'pending' &&
                    t('detail.statusPending')) ||
                    (approvalDetail.status === 'approved' &&
                      t('detail.statusApproved')) ||
                    (approvalDetail.status === 'rejected' &&
                      t('detail.statusRejected')) ||
                    t('detail.statusPending')}
                </Badge>
              </HStack>

              {/* Type */}
              <HStack>
                <div className="text-muted-foreground w-[90px] text-xs">
                  {t('detail.type')}
                </div>
                <Badge variant="outline" icon={RecommendationIcon}>
                  {t('detail.typeProductRecommendation')}
                </Badge>
              </HStack>

              {/* Created at */}
              <HStack>
                <div className="text-muted-foreground w-[90px] text-xs">
                  {t('detail.createdAt')}
                </div>
                <div className="text-muted-foreground text-sm font-medium">
                  {formatDate(new Date(approvalDetail.createdAt), 'long')}
                </div>
              </HStack>

              {/* Confidence */}
              {approvalDetail.confidence !== undefined && (
                <HStack>
                  <div className="text-muted-foreground w-[90px] text-xs">
                    {t('detail.confidence')}
                  </div>
                  <Badge variant="outline">{approvalDetail.confidence}%</Badge>
                </HStack>
              )}
            </Stack>
          </Stack>

          {/* Recommended Products */}
          {visibleProducts.length > 0 && (
            <Stack gap={4}>
              <h4 className="text-foreground text-lg font-semibold">
                {t('detail.recommendedProducts')}
              </h4>
              <div className="border-border overflow-hidden rounded-[10px] border">
                {visibleProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    type="recommended"
                    canRemove={approvalDetail.status === 'pending'}
                    onRemove={handleRemoveRecommendation}
                    isRemoving={removingProductId === product.id}
                  />
                ))}
              </div>
            </Stack>
          )}

          {/* Previous Purchases */}
          {approvalDetail.previousPurchases.length > 0 && (
            <Stack gap={4}>
              <h4 className="text-foreground text-lg font-semibold">
                {t('detail.userPurchased')}
              </h4>
              <div className="border-border overflow-hidden rounded-[10px] border">
                {approvalDetail.previousPurchases.map((purchase) => (
                  <ProductCard
                    key={purchase.id || purchase.productName}
                    purchase={purchase}
                    type="purchase"
                  />
                ))}
              </div>
            </Stack>
          )}
        </Stack>
      </Dialog>

      {/* Nested dialog for Customer Information */}
      {customerRecord && (
        <CustomerInfoDialog
          customer={customerRecord}
          open={customerInfoOpen}
          onOpenChange={setCustomerInfoOpen}
        />
      )}
    </>
  );
}
