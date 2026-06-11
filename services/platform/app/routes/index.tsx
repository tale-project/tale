import { createFileRoute, redirect } from '@tanstack/react-router';

import { sessionQueryOptions } from '@/app/lib/auth/session-query';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    // fetchQuery rejects on transport failures (after retries) — fall back to
    // the signed-out path rather than surfacing a route error.
    const session = await context.queryClient
      .fetchQuery(sessionQueryOptions)
      .catch(() => null);
    if (session?.data?.user) {
      throw redirect({ to: '/dashboard' });
    }
    throw redirect({ to: '/log-in' });
  },
  component: IndexPage,
});

function IndexPage() {
  return null;
}
