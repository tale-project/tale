import { createCustomersCollection } from '@/lib/collections/entities/customers';
import { useCollection } from '@/lib/collections/use-collection';

export function useCustomerCollection(organizationId: string) {
  return useCollection('customers', createCustomersCollection, organizationId);
}
