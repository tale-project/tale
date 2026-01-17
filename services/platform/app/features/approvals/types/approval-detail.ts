import type { Id } from '@/convex/_generated/dataModel';

/**
 * Recommended product for UI display
 */
export interface RecommendedProduct {
  id: string;
  name: string;
  image: string;
  description?: string;
  relationshipType?: string;
  reasoning?: string;
  confidence?: number;
}

/**
 * Previous purchase for UI display
 */
export interface PreviousPurchase {
  id: string;
  productName: string;
  image: string;
  purchaseDate?: string;
  status?: 'active' | 'cancelled';
}

/**
 * Enriched approval detail for UI display.
 * This is derived from Doc<'approvals'> with processed/formatted data.
 */
export interface ApprovalDetail {
  _id: string;
  organizationId: string;
  customer: {
    id?: Id<'customers'>;
    name: string;
    email: string;
  };
  resourceType: string;
  status: 'pending' | 'approved' | 'rejected';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  confidence?: number;
  createdAt: number;
  reviewer?: string;
  reviewedAt?: number;
  decidedAt?: number;
  comments?: string;
  recommendedProducts: RecommendedProduct[];
  previousPurchases: PreviousPurchase[];
}
