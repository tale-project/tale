import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SandboxesSettings } from '@/app/features/settings/sandboxes/sandboxes-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/sandboxes')({
  head: () => ({
    meta: seo('sandboxes'),
  }),
  component: SandboxesPage,
});

function SandboxesPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <SandboxesSettings organizationId={organizationId} />
    </SettingsPage>
  );
}
