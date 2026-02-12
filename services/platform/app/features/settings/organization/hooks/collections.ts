import { createMembersCollection } from '@/lib/collections/entities/members';
import { useCollection } from '@/lib/collections/use-collection';

export function useMemberCollection(organizationId: string) {
  return useCollection('members', createMembersCollection, organizationId);
}
