import { createFileRoute, Outlet } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

// Pure passthrough layout for the providers section: the index page owns the
// content (and its developer gate); the legacy per-provider child route only
// redirects back to it.
export const Route = createFileRoute('/dashboard/$id/settings/providers')({
  head: () => ({ meta: seo('providers') }),
  component: Outlet,
});
