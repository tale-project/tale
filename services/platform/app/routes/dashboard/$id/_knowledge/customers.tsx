import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersEmptyState } from '@/app/features/customers/components/customers-empty-state';
import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { CustomersTableSkeleton } from '@/app/features/customers/components/customers-table-skeleton';
import {
  useCustomerCollection,
  useCustomers,
} from '@/app/features/customers/hooks/collections';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/customers')({
  validateSearch: searchSchema,
  component: CustomersPage,
});

function CustomersPage() {
  const { id: organizationId } = Route.useParams();
  const customerCollection = useCustomerCollection(organizationId);
  const { customers, isLoading } = useCustomers(customerCollection);

  if (isLoading) {
    return <CustomersTableSkeleton organizationId={organizationId} />;
  }

  if (!customers || customers.length === 0) {
    return <CustomersEmptyState organizationId={organizationId} />;
  }

  return (
    <CustomersTable organizationId={organizationId} customers={customers} />
  );
}
