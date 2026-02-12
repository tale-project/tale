import { createApprovalsCollection } from '@/lib/collections/entities/approvals';
import { useCollection } from '@/lib/collections/use-collection';

export function useApprovalCollection(organizationId: string) {
  return useCollection('approvals', createApprovalsCollection, organizationId);
}
