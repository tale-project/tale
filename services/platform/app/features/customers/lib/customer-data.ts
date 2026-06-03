import type { Doc } from '@/convex/_generated/dataModel';
import type { CustomerInfo } from '@/convex/conversations/types';

export type CustomerData = Doc<'customers'> | CustomerInfo;

type CustomerStatus = Doc<'customers'>['status'];

export const CUSTOMER_STATUSES = ['active', 'churned', 'potential'] as const;

const VALID_STATUSES = new Set<string>(CUSTOMER_STATUSES);

export function isValidStatus(
  status: string | undefined,
): status is CustomerStatus {
  return status !== undefined && VALID_STATUSES.has(status);
}

export function isCustomerDoc(
  customer: CustomerData,
): customer is Doc<'customers'> {
  return '_creationTime' in customer;
}
