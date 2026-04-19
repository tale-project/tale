import { convexQuery } from '@convex-dev/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useAction, useMutation } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Card } from '@/app/components/ui/layout/card';
import { FullPageCenter } from '@/app/components/ui/layout/full-page-center';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
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
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.getUserOrganizationsWithDetails, {}),
    );
  },
  component: DashboardIndex,
});

function DashboardIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initializeWorkflows = useAction(
    api.organizations.actions.initializeDefaultWorkflows,
  );
  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const creatingRef = useRef(false);
  const autoSelectedRef = useRef(false);
  const { data: organizations, isLoading: isOrgsLoading } = useConvexQuery(
    api.members.queries.getUserOrganizationsWithDetails,
  );

  const [isEntering, setIsEntering] = useState(false);

  const enterOrg = async (orgId: string) => {
    setIsEntering(true);
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      // Invalidate the TanStack-cached session (5-min stale) so the
      // activeOrganizationId route guard sees the fresh value.
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      try {
        await recordOrgSwitch({ organizationId: orgId });
      } catch (err) {
        // Audit logging failure shouldn't block UX.
        console.warn('Failed to record org switch audit entry:', err);
      }
      await navigate({ to: '/dashboard/$id', params: { id: orgId } });
    } catch (error) {
      console.error('Failed to enter organization:', error);
      setIsEntering(false);
    }
  };

  useEffect(() => {
    if (isOrgsLoading || !organizations) return;

    if (organizations.length === 0) {
      if (creatingRef.current) return;
      creatingRef.current = true;
      void createDefaultOrganization();
      return;
    }

    if (organizations.length === 1 && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      const onlyOrg = organizations[0];
      if (onlyOrg) {
        void enterOrg(onlyOrg.organizationId);
      }
    }

    async function createDefaultOrganization() {
      try {
        const result = await authClient.organization.create({
          name: 'Default',
          slug: 'default',
        });
        const orgId = result.data?.id;
        if (!orgId) throw new Error('Failed to create organization');

        await authClient.organization.setActive({ organizationId: orgId });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
        await initializeWorkflows({ organizationId: orgId });

        try {
          await recordOrgSwitch({ organizationId: orgId });
        } catch (err) {
          console.warn('Failed to record org switch audit entry:', err);
        }

        void navigate({ to: '/dashboard/$id', params: { id: orgId } });
      } catch (error) {
        console.error('Failed to create default organization:', error);
        void navigate({ to: '/dashboard/create-organization' });
      }
    }
    // enterOrg intentionally not in deps — ref guard prevents re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOrgsLoading,
    organizations,
    navigate,
    initializeWorkflows,
    queryClient,
    recordOrgSwitch,
  ]);

  // Waiting on queries or mid-transition → spinner
  if (isOrgsLoading || !organizations || isEntering) {
    return (
      <FullPageCenter>
        <Spinner size="lg" />
      </FullPageCenter>
    );
  }

  // 0 orgs or 1 org → effect above handles routing; keep spinner
  if (organizations.length <= 1) {
    return (
      <FullPageCenter>
        <Spinner size="lg" />
      </FullPageCenter>
    );
  }

  // N orgs → explicit picker
  return (
    <FullPageCenter>
      <Stack gap={5} className="w-full max-w-md p-6">
        <Stack gap={1}>
          <Text className="text-xl font-semibold">Select an organization</Text>
          <Text variant="muted" className="text-sm">
            You belong to more than one organization. Choose which one to enter.
          </Text>
        </Stack>
        <Stack gap={2}>
          {organizations.map((org) => (
            <Card
              key={org.organizationId}
              contentClassName="p-4"
              className="hover:bg-muted/50 cursor-pointer transition-colors"
            >
              <HStack justify="between" align="center">
                <Stack gap={1}>
                  <Text className="text-sm font-medium">{org.name}</Text>
                  <Text variant="muted" className="text-xs">
                    {org.slug ? `@${org.slug} · ` : ''}role: {org.role}
                  </Text>
                </Stack>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void enterOrg(org.organizationId)}
                >
                  Enter
                </Button>
              </HStack>
            </Card>
          ))}
        </Stack>
      </Stack>
    </FullPageCenter>
  );
}
