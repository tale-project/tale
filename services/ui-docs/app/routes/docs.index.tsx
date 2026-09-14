import { createFileRoute, redirect } from '@tanstack/react-router';

import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';

/**
 * `/docs` has no page of its own — the navigation's first entry is the
 * documentation's front door, so send a reader straight there instead of
 * showing an index that repeats the rail.
 */
export const Route = createFileRoute('/docs/')({
  beforeLoad: () => {
    throw redirect({ to: docPath(firstNavSlug()), replace: true });
  },
});
