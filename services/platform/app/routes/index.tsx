import { createFileRoute, redirect } from '@tanstack/react-router';

import { sessionQueryOptions } from '@/app/lib/auth/session-query';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQueryOptions);
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
