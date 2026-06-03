import type { Doc } from '@/convex/_generated/dataModel';
import type { CustomerInfo } from '@/convex/conversations/types';

export type CustomerData = Doc<'customers'> | CustomerInfo;

type CustomerStatus = Doc<'customers'>['status'];

const VALID_STATUSES = new Set(['active', 'churned', 'potential']);

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
