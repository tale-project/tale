import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { api } from '@/convex/_generated/api';
import { getDefaultSettingsRoute } from '@/lib/permissions/get-default-settings-route';

export const Route = createFileRoute('/dashboard/$id/settings/')({
  beforeLoad: ({ context, params }) => {
    const memberContext = context.queryClient.getQueryData(
      convexQuery(api.members.queries.getCurrentMemberContext, {
        organizationId: params.id,
      }).queryKey,
    );

    throw redirect({
      to: getDefaultSettingsRoute(memberContext?.role ?? null),
      params: { id: params.id },
    });
  },
});
