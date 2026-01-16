import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  component: DashboardRedirect,
});

function DashboardRedirect() {
  return <Outlet />;
}
