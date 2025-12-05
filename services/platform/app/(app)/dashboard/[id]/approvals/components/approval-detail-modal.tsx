'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import ProductCard from './product-card';
import { ApprovalDetail } from '../types/approval-detail';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { formatDate as formatDateUtil } from '@/lib/utils/date/format';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

const CustomerInfoDialog = dynamic(
  () =>
    import('@/components/email-table/customer-info-dialog').then((mod) => ({
      default: mod.CustomerInfoDialog,
    })),
  { ssr: false },
);

const RecommendationIcon = () => (
  <Sparkles className="size-4 text-muted-foreground" />
);

interface ApprovalDetailModalProps {
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

export default function ApprovalDetailModal({
  open,
  onOpenChange,
  approvalDetail,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
  onRemoveRecommendation,
  removingProductId,
}: ApprovalDetailModalProps) {
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);

  const customer = useQuery(
    api.customers.getCustomerByEmail,
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
      locale: 'en-US',
    });
  };

  const visibleProducts = sortedProducts.slice(0, 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[376px] max-h-[90vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-4 py-6 border-b border-border">
          <DialogTitle className="font-semibold text-foreground">
            Approval details
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div
          className={cn(
            'p-4 space-y-10 max-h-[calc(90vh-88px)] overflow-y-auto',
            approvalDetail.status === 'pending' && 'pb-20',
          )}
        >
          {/* Customer Info */}
          <div className="space-y-8">
            <div className="space-y-1">
              <h3 className="text-base font-medium text-foreground">
                {approvalDetail.customer.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {approvalDetail.customer.email}
              </p>
            </div>

            {/* Approval Details */}
            <div className="space-y-3">
              {/* Status */}
              <div className="flex items-center">
                <div className="w-[90px] text-xs text-muted-foreground">
                  Status
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
                  {(approvalDetail.status === 'pending' && 'Pending') ||
                    (approvalDetail.status === 'approved' && 'Approved') ||
                    (approvalDetail.status === 'rejected' && 'Rejected') ||
                    'Pending'}
                </Badge>
              </div>

              {/* Type */}
              <div className="flex items-center">
                <div className="w-[90px] text-xs text-muted-foreground">
                  Type
                </div>
                <Badge variant="outline" icon={RecommendationIcon}>
                  Product recommendation
                </Badge>
              </div>

              {/* Created at */}
              <div className="flex items-center">
                <div className="w-[90px] text-xs text-muted-foreground">
                  Created at
                </div>
                <div className="text-sm font-medium text-muted-foreground">
                  {formatDate(approvalDetail.createdAt)}
                </div>
              </div>

              {/* Confidence */}
              {approvalDetail.confidence !== undefined && (
                <div className="flex items-center">
                  <div className="w-[90px] text-xs text-muted-foreground">
                    Confidence
                  </div>
                  <Badge variant="outline">{approvalDetail.confidence}%</Badge>
                </div>
              )}
            </div>
          </div>

          {/* Recommended Products */}
          {visibleProducts.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-foreground">
                Recommended products
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
            </div>
          )}

          {/* Previous Purchases */}
          {approvalDetail.previousPurchases.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-foreground">
                User purchased
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
            </div>
          )}
        </div>

        {/* Action Buttons - Only show for pending approvals */}
        {approvalDetail.status === 'pending' && (
          <DialogFooter className="p-4 border-t border-border bg-background flex gap-3">
            <Button
              onClick={() => onReject?.(approvalDetail._id)}
              disabled={isApproving || isRejecting}
              variant="outline"
              className="flex-1"
            >
              Reject
            </Button>
            <Button
              onClick={() => onApprove?.(approvalDetail._id)}
              disabled={isApproving || isRejecting}
              className="flex-1"
            >
              Approve
            </Button>
          </DialogFooter>
        )}
      </DialogContent>

      {/* Nested dialog for Customer Information */}
      {customerInfoOpen && customerRecord && (
        <Dialog open={customerInfoOpen} onOpenChange={setCustomerInfoOpen}>
          <CustomerInfoDialog customer={customerRecord} />
        </Dialog>
      )}
    </Dialog>
  );
}
