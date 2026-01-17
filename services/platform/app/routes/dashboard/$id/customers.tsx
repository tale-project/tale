import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { CustomersTableSkeleton } from '@/app/features/customers/components/customers-table-skeleton';
import { CustomersEmptyState } from '@/app/features/customers/components/customers-empty-state';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  locale: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/customers')({
  validateSearch: searchSchema,
  component: CustomersPage,
});

function CustomersPage() {
  const { id: organizationId } = Route.useParams();
  const hasCustomers = useQuery(api.customers.hasCustomers, { organizationId });

  if (hasCustomers === undefined) {
    return <CustomersTableSkeleton organizationId={organizationId} />;
  }

  if (!hasCustomers) {
    return <CustomersEmptyState organizationId={organizationId} />;
  }

  return (
    <Suspense fallback={<CustomersTableSkeleton organizationId={organizationId} />}>
      <CustomersTable organizationId={organizationId} />
    </Suspense>
  );
}
