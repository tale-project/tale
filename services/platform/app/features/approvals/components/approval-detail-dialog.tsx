'use client';

import { useState, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { ProductCard } from './product-card';
import { ApprovalDetail } from '../types/approval-detail';
import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';
import { formatDate as formatDateUtil } from '@/lib/utils/date/format';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useLocale, useT } from '@/lib/i18n/client';
import { CustomerInfoDialog } from '@/app/features/customers/components/customer-info-dialog';

const RecommendationIcon = () => (
  <Sparkles className="size-4 text-muted-foreground" />
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
  const locale = useLocale();
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);

  const customer = useQuery(
    api.customers.queries.getCustomerByEmail,
    approvalDetail?.customer.email
      ? {
          email: approvalDetail.customer.email,
          organizationId: approvalDetail.organizationId,
        }
      : 'skip',
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

  const customerRecord = customer || null;

  const handleRemoveRecommendation = (productId: string) => {
    if (!onRemoveRecommendation) return;
    onRemoveRecommendation(approvalDetail._id, productId);
  };

  const formatDate = (timestamp: number) => {
    return formatDateUtil(new Date(timestamp).toISOString(), {
      preset: 'long',
      locale,
    });
  };

  const visibleProducts = sortedProducts.slice(0, 3);

  const footer =
    approvalDetail.status === 'pending' ? (
      <div className="flex gap-3 w-full">
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
        className="w-full max-h-[90vh] overflow-hidden p-0 sm:p-0 gap-0 flex flex-col"
        footer={footer}
        footerClassName="p-4 border-t border-border bg-background"
        customHeader={
          <div className="px-4 py-6 border-b border-border">
            <h2 className="text-base font-semibold leading-none tracking-tight text-foreground">
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
              <h3 className="text-base font-medium text-foreground">
                {approvalDetail.customer.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {approvalDetail.customer.email}
              </p>
            </Stack>

            {/* Approval Details */}
            <Stack gap={3}>
              {/* Status */}
              <HStack>
                <div className="w-[90px] text-xs text-muted-foreground">
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
                <div className="w-[90px] text-xs text-muted-foreground">
                  {t('detail.type')}
                </div>
                <Badge variant="outline" icon={RecommendationIcon}>
                  {t('detail.typeProductRecommendation')}
                </Badge>
              </HStack>

              {/* Created at */}
              <HStack>
                <div className="w-[90px] text-xs text-muted-foreground">
                  {t('detail.createdAt')}
                </div>
                <div className="text-sm font-medium text-muted-foreground">
                  {formatDate(approvalDetail.createdAt)}
                </div>
              </HStack>

              {/* Confidence */}
              {approvalDetail.confidence !== undefined && (
                <HStack>
                  <div className="w-[90px] text-xs text-muted-foreground">
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
              <h4 className="text-lg font-semibold text-foreground">
                {t('detail.recommendedProducts')}
              </h4>
              <div className="border border-border rounded-[10px] overflow-hidden">
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
              <h4 className="text-lg font-semibold text-foreground">
                {t('detail.userPurchased')}
              </h4>
              <div className="border border-border rounded-[10px] overflow-hidden">
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
