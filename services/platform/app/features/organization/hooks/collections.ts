import { createUserOrganizationsCollection } from '@/lib/collections/entities/user-organizations';
import { useCollection } from '@/lib/collections/use-collection';

export function useUserOrganizationCollection() {
  return useCollection(
    'user-organizations',
    createUserOrganizationsCollection,
    'current-user',
  );
}
