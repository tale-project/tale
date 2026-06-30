import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { AuditLogsPage } from '@/app/features/settings/audit-logs/components/audit-logs-page';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  category: z.string().optional(),
  tab: z.enum(['audit', 'blocks', 'activity', 'errors']).optional(),
});

type LogsTab = NonNullable<z.infer<typeof searchSchema>['tab']>;

// Type guard (not a cast) so narrowing the `string` from Radix's
// `onValueChange` to the tab enum stays type-safe — the type-aware lint
// rejects a `value as LogsTab` assertion here.
function isLogsTab(value: string): value is LogsTab {
  return (
    value === 'audit' ||
    value === 'blocks' ||
    value === 'activity' ||
    value === 'errors'
  );
}

export const Route = createFileRoute('/dashboard/$id/settings/governance/logs')(
  {
    head: () => ({ meta: seo('logs') }),
    validateSearch: searchSchema,
    component: LogsRoute,
  },
);

function LogsRoute() {
  const { id: organizationId } = Route.useParams();
  const { category, tab } = Route.useSearch();
  const navigate = useNavigate();

  // Both `category` and `tab` round-trip through the URL; each handler carries
  // the other's current value forward so changing one never drops the other.
  // The default tab (`audit`) is omitted from the URL so the canonical entry
  // path stays clean, mirroring how an empty `category` is left off.
  const handleCategoryChange = useCallback(
    (next: string | undefined) => {
      void navigate({
        to: '/dashboard/$id/settings/governance/logs',
        params: { id: organizationId },
        search: { category: next || undefined, tab },
      });
    },
    [navigate, organizationId, tab],
  );

  const handleTabChange = useCallback(
    (next: string) => {
      void navigate({
        to: '/dashboard/$id/settings/governance/logs',
        params: { id: organizationId },
        search: {
          category,
          tab: next === 'audit' || !isLogsTab(next) ? undefined : next,
        },
      });
    },
    [navigate, organizationId, category],
  );

  return (
    <AuditLogsPage
      organizationId={organizationId}
      category={category}
      onCategoryChange={handleCategoryChange}
      tab={tab}
      onTabChange={handleTabChange}
    />
  );
}
