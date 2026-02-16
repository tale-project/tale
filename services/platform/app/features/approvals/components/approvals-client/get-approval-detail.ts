import type { ApprovalDetail } from '@/app/features/approvals/types/approval-detail';
import type { Doc } from '@/convex/_generated/dataModel';

import { toId } from '@/convex/lib/type_cast_helpers';
import {
  safeGetString,
  safeGetNumber,
  safeGetArray,
} from '@/lib/utils/safe-parsers';

type ApprovalItem = Doc<'approvals'>;

export function getApprovalDetail(approval: ApprovalItem): ApprovalDetail {
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
      const purchaseDate = safeGetString(product, 'purchaseDate', undefined);
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
}
