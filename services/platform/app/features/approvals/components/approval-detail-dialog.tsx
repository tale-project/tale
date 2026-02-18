'use client';

import { Sparkles } from 'lucide-react';
import { useState, useMemo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { SectionHeader } from '@/app/components/ui/layout/section-header';
import { Button } from '@/app/components/ui/primitives/button';
import { CustomerInfoDialog } from '@/app/features/customers/components/customer-info-dialog';
import {
  useCustomerByEmail,
  useCustomers,
} from '@/app/features/customers/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
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

  const { customers } = useCustomers(approvalDetail?.organizationId ?? '');
  const customerRecord = useCustomerByEmail(
    customers,
    approvalDetail?.customer.email,
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
          variant="secondary"
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
            <SectionHeader title={t('detail.title')} />
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
            <SectionHeader
              as="h3"
              weight="medium"
              title={approvalDetail.customer.name}
              description={approvalDetail.customer.email}
            />

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
            <PageSection
              as="h3"
              titleSize="lg"
              title={t('detail.recommendedProducts')}
            >
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
            </PageSection>
          )}

          {/* Previous Purchases */}
          {approvalDetail.previousPurchases.length > 0 && (
            <PageSection
              as="h3"
              titleSize="lg"
              title={t('detail.userPurchased')}
            >
              <div className="border-border overflow-hidden rounded-[10px] border">
                {approvalDetail.previousPurchases.map((purchase) => (
                  <ProductCard
                    key={purchase.id || purchase.productName}
                    purchase={purchase}
                    type="purchase"
                  />
                ))}
              </div>
            </PageSection>
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
