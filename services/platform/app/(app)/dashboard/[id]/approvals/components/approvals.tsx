'use client';

import { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { CheckIcon, GitCompare, Info, Loader2, X } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { toast } from '@/hooks/use-toast';
import ApprovalDetailModal from './approval-detail-modal';
import { ApprovalDetail } from '../types/approval-detail';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/date/format';
import { useMutation, usePreloadedQuery, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id, Doc } from '@/convex/_generated/dataModel';
import type { PreloadedApprovals } from '../utils/get-approvals-data';

type ApprovalDoc = Doc<'approvals'>;

interface ApprovalsProps {
  status?: 'pending' | 'resolved';
  organizationId: string;
  preloadedApprovals: PreloadedApprovals;
}

export default function Approvals({
  status,
  organizationId,
  preloadedApprovals,
}: ApprovalsProps) {
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(
    null,
  );
  const [removingProductId, setRemovingProductId] = useState<string | null>(
    null,
  );
  const [approvalDetailModalOpen, setApprovalDetailModalOpen] = useState(false);

  // Use preloaded data with real-time reactivity
  // This provides SSR benefits AND automatic updates when data changes
  // Filtering (status and search) is now done server-side in the Convex query
  const approvals = usePreloadedQuery(preloadedApprovals);

  // Get current member
  const memberContext = useQuery(api.member.getCurrentMemberContext, {
    organizationId: organizationId as string,
  });

  // Mutation: update approval status with optimistic update
  // When status changes, the approval is removed from the current list immediately
  const updateApprovalStatus = useMutation(
    api.approvals.updateApprovalStatusPublic,
  ).withOptimisticUpdate((localStore, args) => {
    // Get the current query result
    const currentApprovals = localStore.getQuery(
      api.approvals.getApprovalsByOrganization,
      {
        organizationId,
        status: status === 'pending' ? 'pending' : 'resolved',
        resourceType: ['product_recommendation'],
        limit: 500,
      },
    );

    if (currentApprovals !== undefined) {
      // Remove the approval from the list (it will move to the other status)
      const updatedApprovals = currentApprovals.filter(
        (approval) => approval._id !== args.approvalId,
      );
      localStore.setQuery(
        api.approvals.getApprovalsByOrganization,
        {
          organizationId,
          status: status === 'pending' ? 'pending' : 'resolved',
          resourceType: ['product_recommendation'],
          limit: 500,
        },
        updatedApprovals,
      );
    }
  });

  const removeRecommendedProduct = useMutation(
    api.approvals.removeRecommendedProduct,
  );

  const handleApprove = async (approvalId: string) => {
    if (!memberContext?.member?._id) {
      toast({
        title: 'You must be logged in to approve.',
        variant: 'destructive',
      });
      return;
    }

    setApproving(approvalId);
    try {
      await updateApprovalStatus({
        approvalId: approvalId as Id<'approvals'>,
        status: 'approved',
        approvedBy: memberContext.member._id,
        comments: 'Approved via UI',
      });
    } catch (error) {
      console.error('Failed to approve:', error);
      toast({
        title: 'Failed to approve. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    if (!memberContext?.member?._id) {
      toast({
        title: 'You must be logged in to reject.',
        variant: 'destructive',
      });
      return;
    }

    setRejecting(approvalId);
    try {
      await updateApprovalStatus({
        approvalId: approvalId as Id<'approvals'>,
        status: 'rejected',
        approvedBy: memberContext.member._id,
        comments: 'Rejected via UI',
      });
    } catch (error) {
      console.error('Failed to reject:', error);
      toast({
        title: 'Failed to reject. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setRejecting(null);
    }
  };

  const handleRemoveRecommendation = async (
    approvalId: string,
    productId: string,
  ) => {
    if (!memberContext?.member?._id) {
      toast({
        title: 'You must be logged in to update recommendations.',
        variant: 'destructive',
      });
      return;
    }

    setRemovingProductId(productId);
    try {
      await removeRecommendedProduct({
        approvalId: approvalId as Id<'approvals'>,
        productId,
      });
    } catch (error) {
      console.error('Failed to remove recommendation:', error);
      toast({
        title: 'Failed to remove recommendation. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setRemovingProductId(null);
    }
  };

  const handleApprovalRowClick = (approvalId: string) => {
    setSelectedApprovalId(approvalId);
    setApprovalDetailModalOpen(true);
  };

  const handleApprovalDetailOpenChange = (open: boolean) => {
    setApprovalDetailModalOpen(open);
    if (!open) {
      setSelectedApprovalId(null);
    }
  };

  // Function to get approval detail data
  const getApprovalDetail = (approvalId: string): ApprovalDetail | null => {
    const approval = approvals.find((a) => a._id === approvalId);
    if (!approval) return null;

    // Cast metadata to Record for dynamic property access
    const metadata = (approval.metadata || {}) as Record<string, unknown>;

    // Map recommended products using the canonical shape: productId, productName, relationshipType (camelCase)
    const recommendedProducts = (
      Array.isArray(metadata['recommendedProducts'])
        ? (metadata['recommendedProducts'] as Array<Record<string, unknown>>)
        : []
    ).map((product, index: number) => {
      const id =
        (typeof product['productId'] === 'string' &&
          (product['productId'] as string)) ||
        `rec-${index}`;
      const name =
        (typeof product['productName'] === 'string' &&
          (product['productName'] as string)) ||
        '';
      const image =
        (typeof product['imageUrl'] === 'string' &&
          (product['imageUrl'] as string)) ||
        '/assets/placeholder-image.png';
      const relationshipType =
        (typeof product['relationshipType'] === 'string' &&
          (product['relationshipType'] as string)) ||
        undefined;
      const reasoning =
        (typeof product['reasoning'] === 'string' &&
          (product['reasoning'] as string)) ||
        undefined;
      const confidence =
        (typeof product['confidence'] === 'number' &&
          (product['confidence'] as number)) ||
        undefined;
      return { id, name, image, relationshipType, reasoning, confidence };
    });

    // Map event products (previous purchases) with direct fallbacks
    const previousPurchases = (
      Array.isArray(metadata['eventProducts'])
        ? (metadata['eventProducts'] as Array<Record<string, unknown>>)
        : []
    ).map((product, index: number) => {
      const id =
        (typeof product['id'] === 'string' && (product['id'] as string)) ||
        `prev-${index}`;
      const productName =
        (typeof product['productName'] === 'string' &&
          (product['productName'] as string)) ||
        (typeof product['name'] === 'string' && (product['name'] as string)) ||
        (typeof product['product_name'] === 'string' &&
          (product['product_name'] as string)) ||
        '';
      const image =
        (typeof product['image'] === 'string' &&
          (product['image'] as string)) ||
        (typeof product['imageUrl'] === 'string' &&
          (product['imageUrl'] as string)) ||
        (typeof product['image_url'] === 'string' &&
          (product['image_url'] as string)) ||
        '/assets/placeholder-image.png';
      const purchaseDate =
        typeof product['purchaseDate'] === 'string'
          ? (product['purchaseDate'] as string)
          : undefined;
      const status =
        product['status'] === 'active' || product['status'] === 'cancelled'
          ? (product['status'] as 'active' | 'cancelled')
          : undefined;
      return { id, productName, image, purchaseDate, status };
    });

    // Convert confidence to percentage if needed
    const metaConfidence = (() => {
      const raw =
        typeof (metadata as Record<string, unknown>)['confidence'] === 'number'
          ? ((metadata as Record<string, unknown>)['confidence'] as number)
          : undefined;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      return raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    })();

    return {
      _id: approval._id,
      organizationId: approval.organizationId,
      customer: {
        id: metadata['customerId'] as Id<'customers'> | undefined,
        name:
          typeof metadata['customerName'] === 'string'
            ? (metadata['customerName'] as string).trim()
            : '',
        email:
          typeof metadata['customerEmail'] === 'string'
            ? (metadata['customerEmail'] as string)
            : '',
      },
      resourceType: approval.resourceType,
      status: approval.status as 'pending' | 'approved' | 'rejected',
      priority: approval.priority as 'low' | 'medium' | 'high' | 'urgent',
      confidence: metaConfidence,
      createdAt: approval._creationTime,
      reviewer: metadata['approverName'] as string | undefined,
      reviewedAt: approval.reviewedAt,
      decidedAt: approval.reviewedAt, // Use reviewedAt as decidedAt
      comments: metadata['comments'] as string | undefined, // Get comments from metadata
      recommendedProducts,
      previousPurchases,
    };
  };

  const getApprovalTypeLabel = (resourceType: string): string => {
    switch (resourceType) {
      case 'conversations':
        return 'Review reply';
      case 'product_recommendation':
        return 'Recommend product';
      default:
        return 'Review';
    }
  };

  const renderProductList = (products: unknown, isRecommendation = false) => {
    const list: Array<Record<string, unknown>> = Array.isArray(products)
      ? (products as Array<Record<string, unknown>>)
      : [];
    if (list.length === 0) return null;

    // For recommendations, show first product with full name, second with count
    if (isRecommendation) {
      // Sort by confidence
      const sortedList = [...list].sort((a, b) => {
        const confA =
          typeof a['confidence'] === 'number' ? (a['confidence'] as number) : 0;
        const confB =
          typeof b['confidence'] === 'number' ? (b['confidence'] as number) : 0;
        return confB - confA;
      });

      const firstProduct = sortedList[0];
      const remainingCount = sortedList.length - 1;
      const secondProduct = sortedList[1];

      const firstName =
        (typeof firstProduct['name'] === 'string' &&
          (firstProduct['name'] as string)) ||
        (typeof firstProduct['productName'] === 'string' &&
          (firstProduct['productName'] as string)) ||
        '';
      const firstImage =
        (typeof firstProduct['image'] === 'string' &&
          (firstProduct['image'] as string)) ||
        (typeof firstProduct['imageUrl'] === 'string' &&
          (firstProduct['imageUrl'] as string)) ||
        '/assets/placeholder-image.png';

      return (
        <div className="flex flex-col gap-1">
          {/* First product with full name */}
          <div className="flex items-center gap-2">
            <div className="size-5 bg-muted rounded flex-shrink-0 overflow-hidden">
              <Image
                src={firstImage}
                alt={firstName}
                width={20}
                height={20}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (target.src !== '/assets/placeholder-image.png') {
                    target.src = '/assets/placeholder-image.png';
                  }
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-normal leading-normal whitespace-nowrap">
              {firstName}
            </span>
          </div>
          {/* Second product with count if there are more products */}
          {remainingCount > 0 && secondProduct && (
            <div className="flex items-center gap-2">
              <div className="size-5 bg-muted rounded flex-shrink-0 overflow-hidden">
                <Image
                  src={
                    (typeof secondProduct['image'] === 'string' &&
                      (secondProduct['image'] as string)) ||
                    (typeof secondProduct['imageUrl'] === 'string' &&
                      (secondProduct['imageUrl'] as string)) ||
                    '/assets/placeholder-image.png'
                  }
                  alt={
                    (typeof secondProduct['name'] === 'string' &&
                      (secondProduct['name'] as string)) ||
                    (typeof secondProduct['productName'] === 'string' &&
                      (secondProduct['productName'] as string)) ||
                    ''
                  }
                  width={20}
                  height={20}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (target.src !== '/assets/placeholder-image.png') {
                      target.src = '/assets/placeholder-image.png';
                    }
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground font-normal leading-normal whitespace-nowrap">
                {remainingCount} other product{remainingCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      );
    }

    // For non-recommendations, show all products as before
    return (
      <div className="flex flex-col gap-1">
        {list.map((p, index) => {
          const name =
            (typeof p['name'] === 'string' && (p['name'] as string)) ||
            (typeof p['productName'] === 'string' &&
              (p['productName'] as string)) ||
            '';
          const image =
            (typeof p['image'] === 'string' && (p['image'] as string)) ||
            (typeof p['imageUrl'] === 'string' && (p['imageUrl'] as string)) ||
            '/assets/placeholder-image.png';

          return (
            <div key={index} className="flex items-center gap-2">
              <div className="size-5 bg-muted rounded flex-shrink-0 overflow-hidden">
                <Image
                  src={image}
                  alt={name}
                  width={20}
                  height={20}
                  className="w-full h-full object-cover"
                  unoptimized={/^https?:\/\//.test(image)}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (target.src !== '/assets/placeholder-image.png') {
                      target.src = '/assets/placeholder-image.png';
                    }
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground font-normal leading-normal whitespace-nowrap">
                {name}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // Helper to get customer label
  const getCustomerLabel = useCallback((approval: ApprovalDoc) => {
    const metadata = (approval.metadata || {}) as Record<string, unknown>;
    return (
      (typeof metadata['customerName'] === 'string' &&
        (metadata['customerName'] as string).trim()) ||
      (typeof metadata['customerEmail'] === 'string' &&
        (metadata['customerEmail'] as string).trim()) ||
      'Unknown Customer'
    );
  }, []);

  // Helper to get confidence percentage
  const getConfidencePercent = useCallback((approval: ApprovalDoc) => {
    const metadata = (approval.metadata || {}) as Record<string, unknown>;
    const recs = Array.isArray(metadata['recommendedProducts'])
      ? (metadata['recommendedProducts'] as Array<Record<string, unknown>>)
      : [];
    const firstConf =
      recs.length > 0 && typeof recs[0]['confidence'] === 'number'
        ? (recs[0]['confidence'] as number)
        : 0;
    const raw =
      typeof metadata['confidence'] === 'number'
        ? (metadata['confidence'] as number)
        : firstConf;
    const n = Number(raw);
    return !Number.isFinite(n)
      ? 0
      : n <= 1
        ? Math.round(n * 100)
        : Math.round(n);
  }, []);

  // Pending approvals columns
  const pendingColumns = useMemo<ColumnDef<ApprovalDoc>[]>(
    () => [
      {
        id: 'approval',
        header: 'Approval / Recipient',
        size: 256,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1.5 min-h-[41px]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground tracking-tight">
                {getApprovalTypeLabel(row.original.resourceType)}
              </span>
              <Info className="size-4 text-muted-foreground flex-shrink-0 flex-grow-0" />
            </div>
            <div className="text-sm text-muted-foreground font-normal tracking-tight">
              {getCustomerLabel(row.original)}
            </div>
          </div>
        ),
      },
      {
        id: 'event',
        header: 'Event',
        size: 256,
        cell: ({ row }) => {
          const metadata = (row.original.metadata || {}) as Record<
            string,
            unknown
          >;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">
                Purchase
              </div>
              {renderProductList(
                (metadata['eventProducts'] as Array<unknown>) || [],
              )}
            </div>
          );
        },
      },
      {
        id: 'action',
        header: 'Action',
        size: 256,
        cell: ({ row }) => {
          const metadata = (row.original.metadata || {}) as Record<
            string,
            unknown
          >;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">
                Recommendation
              </div>
              {renderProductList(
                (metadata['recommendedProducts'] as Array<unknown>) || [],
                true,
              )}
            </div>
          );
        },
      },
      {
        id: 'confidence',
        header: () => (
          <span className="text-right w-full block">Confidence</span>
        ),
        size: 100,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <span className="text-xs font-medium text-muted-foreground">
              {getConfidencePercent(row.original)}%
            </span>
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="text-right w-full block">Approved</span>,
        size: 100,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                handleApprove(row.original._id);
              }}
              disabled={
                approving === row.original._id || rejecting === row.original._id
              }
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
                handleReject(row.original._id);
              }}
              disabled={
                approving === row.original._id || rejecting === row.original._id
              }
            >
              {rejecting === row.original._id ? (
                <div className="animate-spin rounded-full size-3 border-b border-foreground" />
              ) : (
                <X className="size-4 text-foreground" />
              )}
            </Button>
          </div>
        ),
      },
    ],
    [
      approving,
      rejecting,
      getCustomerLabel,
      getConfidencePercent,
      handleApprove,
      handleReject,
    ],
  );

  // Resolved approvals columns
  const resolvedColumns = useMemo<ColumnDef<ApprovalDoc>[]>(
    () => [
      {
        id: 'approval',
        header: 'Approval / Recipient',
        size: 256,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1.5 min-h-[41px]">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-foreground tracking-tight">
                Recommend product
              </span>
              <Info className="size-4 text-muted-foreground flex-shrink-0 flex-grow-0" />
            </div>
            <div className="text-sm text-muted-foreground font-normal tracking-tight">
              {getCustomerLabel(row.original)}
            </div>
          </div>
        ),
      },
      {
        id: 'event',
        header: 'Event',
        size: 256,
        cell: ({ row }) => {
          const metadata = (row.original.metadata || {}) as Record<
            string,
            unknown
          >;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">
                Purchase
              </div>
              {renderProductList(
                (metadata['eventProducts'] as Array<unknown>) || [],
              )}
            </div>
          );
        },
      },
      {
        id: 'action',
        header: 'Action',
        size: 256,
        cell: ({ row }) => {
          const metadata = (row.original.metadata || {}) as Record<
            string,
            unknown
          >;
          return (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-foreground">
                Recommendation
              </div>
              {renderProductList(
                (metadata['recommendedProducts'] as Array<unknown>) || [],
                true,
              )}
            </div>
          );
        },
      },
      {
        id: 'reviewer',
        header: 'Reviewer',
        cell: ({ row }) => {
          const metadata = (row.original.metadata || {}) as Record<
            string,
            unknown
          >;
          return (
            <div className="text-sm">
              {(metadata['approverName'] as string) || 'Unknown'}
            </div>
          );
        },
      },
      {
        id: 'reviewedAt',
        header: () => (
          <span className="text-right w-full block">Reviewed at</span>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-right block">
            {row.original.reviewedAt
              ? formatDate(new Date(row.original.reviewedAt).toISOString(), {
                  preset: 'short',
                })
              : ''}
          </span>
        ),
      },
      {
        id: 'status',
        header: () => <span className="text-right w-full block">Approved</span>,
        size: 100,
        cell: ({ row }) => (
          <div className="text-right">
            {row.original.status === 'approved' ? (
              <CheckIcon className="size-4 text-green-600 inline-block" />
            ) : (
              <X className="size-4 text-red-600 inline-block" />
            )}
          </div>
        ),
      },
    ],
    [getCustomerLabel],
  );

  if (approvals.length === 0) {
    return (
      <DataTableEmptyState
        icon={GitCompare}
        title={`No ${status || ''} approvals`}
        description={
          status === 'pending'
            ? 'When human input is needed, your AI will request it here'
            : undefined
        }
      />
    );
  }

  if (status === 'pending') {
    return (
      <>
        <DataTable
          columns={pendingColumns}
          data={approvals}
          getRowId={(row) => row._id}
          onRowClick={(row) => handleApprovalRowClick(row.original._id)}
          rowClassName="cursor-pointer"
        />
        <ApprovalDetailModal
          open={approvalDetailModalOpen}
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

  if (status === 'resolved') {
    return (
      <>
        <DataTable
          columns={resolvedColumns}
          data={approvals}
          getRowId={(row) => row._id}
          onRowClick={(row) => handleApprovalRowClick(row.original._id)}
          rowClassName="cursor-pointer"
        />
        <ApprovalDetailModal
          open={approvalDetailModalOpen}
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

  // Default return with modal for other cases
  return (
    <>
      <DataTableEmptyState icon={GitCompare} title="No approvals found" />
      <ApprovalDetailModal
        open={approvalDetailModalOpen}
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
