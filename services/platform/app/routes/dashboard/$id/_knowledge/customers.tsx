import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { CustomersEmptyState } from '@/app/features/customers/components/customers-empty-state';
import { CustomersTable } from '@/app/features/customers/components/customers-table';
import { CustomersTableSkeleton } from '@/app/features/customers/components/customers-table-skeleton';
import { api } from '@/convex/_generated/api';

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
  const { data: hasCustomers, isLoading } = useQuery(
    convexQuery(api.customers.queries.hasCustomers, { organizationId }),
  );

  if (isLoading) {
    return <CustomersTableSkeleton organizationId={organizationId} />;
  }

  if (!hasCustomers) {
    return <CustomersEmptyState organizationId={organizationId} />;
  }

  return <CustomersTable organizationId={organizationId} />;
}
