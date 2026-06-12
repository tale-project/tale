import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { AuditLogsPage } from '@/app/features/settings/audit-logs/components/audit-logs-page';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  category: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/governance/logs')(
  {
    head: () => ({ meta: seo('logs') }),
    validateSearch: searchSchema,
    component: LogsRoute,
  },
);

function LogsRoute() {
  const { id: organizationId } = Route.useParams();
  const { category } = Route.useSearch();
  const navigate = useNavigate();

  const handleCategoryChange = useCallback(
    (next: string | undefined) => {
      void navigate({
        to: '/dashboard/$id/settings/governance/logs',
        params: { id: organizationId },
        search: next ? { category: next } : {},
      });
    },
    [navigate, organizationId],
  );

  return (
    <AuditLogsPage
      organizationId={organizationId}
      category={category}
      onCategoryChange={handleCategoryChange}
    />
  );
}
