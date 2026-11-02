import { createFileRoute, redirect } from '@tanstack/react-router';

import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { hasAnyUsersQuery } from '@/app/lib/backend/account';

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
    // An install without any account goes straight to first-run setup, so the
    // sign-in page never renders on its way there. Only an answer says so: a
    // read that failed knows nothing of the install and falls back to
    // `/log-in`, which reads it again. The cached answer serves `/setup` too.
    const hasUsers = await context.queryClient
      .fetchQuery(hasAnyUsersQuery())
      .catch((error: unknown) => {
        console.warn('Failed to read whether any account exists:', error);
        return null;
      });
    if (hasUsers === false) {
      throw redirect({ to: '/setup' });
    }
    throw redirect({ to: '/log-in' });
  },
  component: IndexPage,
});

function IndexPage() {
  return null;
}
