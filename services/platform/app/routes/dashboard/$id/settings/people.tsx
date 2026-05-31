import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { PeopleSettings } from '@/app/features/settings/people/components/people-settings';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  tab: z.enum(['members', 'teams']).optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/people')({
  head: () => ({ meta: seo('people') }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.listByOrganization, {
        organizationId: params.id,
      }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.members.queries.listOrgTeams, {
        organizationId: params.id,
      }),
    );
  },
  component: PeoplePage,
});

function PeoplePage() {
  const { id: organizationId } = Route.useParams();
  const { tab = 'members' } = Route.useSearch();
  const navigate = useNavigate();
  const { data: memberContext } = useCurrentMemberContext(organizationId);

  const handleTabChange = useCallback(
    (next: 'members' | 'teams') => {
      void navigate({
        to: '/dashboard/$id/settings/people',
        params: { id: organizationId },
        search: next === 'members' ? {} : { tab: next },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <PeopleSettings
      organizationId={organizationId}
      memberContext={memberContext ?? null}
      tab={tab}
      onTabChange={handleTabChange}
    />
  );
}
