import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/dashboard/')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
    return { user: session.data.user };
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const organizations = useQuery(api.members.queries.getUserOrganizationsList, {});

  useEffect(() => {
    if (organizations === undefined) {
      return;
    }

    if (organizations.length === 0) {
      navigate({ to: '/dashboard/create-organization' });
    } else {
      navigate({ to: '/dashboard/$id', params: { id: organizations[0].organizationId } });
    }
  }, [organizations, navigate]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}
