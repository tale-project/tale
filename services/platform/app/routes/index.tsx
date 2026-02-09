import { createFileRoute, redirect } from '@tanstack/react-router';

import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
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
