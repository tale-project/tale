import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * Legacy path — the governance sub-item was renamed from "Audit logs" to
 * "Logs" when the activity/error tabs landed. Keeps old bookmarks and
 * deep links (including category-filtered ones) working.
 */
export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/audit-logs',
)({
  validateSearch: z.object({
    category: z.string().optional(),
  }),
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/dashboard/$id/settings/governance/logs',
      params: { id: params.id },
      search: search.category ? { category: search.category } : {},
    });
  },
});
