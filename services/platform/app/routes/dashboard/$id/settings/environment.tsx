import { createFileRoute } from '@tanstack/react-router';

import { UserEnvSettings } from '@/app/features/settings/user-env/components/user-env-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/environment')({
  head: () => ({
    meta: seo('environment'),
  }),
  // Warm the env list so a warm navigation renders the real rows on first
  // paint instead of the skeleton. Best-effort — the component's own loading
  // state still renders correctly if this misses.
  loader: ({ context, params }) => {
    void ensureConvexQuery(context, 'sandbox/user_env:listMyEnv', {
      organizationId: params.id,
    }).catch(console.warn);
  },
  component: EnvironmentPage,
});

function EnvironmentPage() {
  return <UserEnvSettings />;
}
