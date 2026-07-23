import { createFileRoute, Outlet } from '@tanstack/react-router';

import { seo } from '@/lib/utils/seo';

/**
 * The chat section. The screen itself is rendered by the child routes — the
 * index for a fresh conversation, `$threadId` for an open one — so both share
 * one URL space and one set of metadata.
 */
export const Route = createFileRoute('/dashboard/$id/chat')({
  head: () => ({
    meta: seo('chat'),
  }),
  component: () => <Outlet />,
});
