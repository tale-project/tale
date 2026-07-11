import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { RuntimesSettings } from '@/app/features/settings/runtimes/runtimes-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/runtimes')({
  head: () => ({ meta: seo('runtimes') }),
  component: ApiRuntimesPage,
});

function ApiRuntimesPage() {
  const { id: organizationId } = Route.useParams();

  // Access is gated by the parent `api` route layout.
  return (
    <SettingsPage>
      <RuntimesSettings organizationId={organizationId} />
    </SettingsPage>
  );
}
