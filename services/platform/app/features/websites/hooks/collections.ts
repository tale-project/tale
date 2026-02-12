import { createWebsitesCollection } from '@/lib/collections/entities/websites';
import { useCollection } from '@/lib/collections/use-collection';

export function useWebsiteCollection(organizationId: string) {
  return useCollection('websites', createWebsitesCollection, organizationId);
}
