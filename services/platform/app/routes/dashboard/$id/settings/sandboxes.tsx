import { createFileRoute } from '@tanstack/react-router';

import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SandboxesSettings } from '@/app/features/settings/sandboxes/sandboxes-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/sandboxes')({
  loader: ({ context, params }) =>
    ensureConvexQuery(
      context,
      'sandbox/session_queries_public:getSandboxQuotaUsage',
      {
        organizationId: params.id,
      },
    ).catch((error: unknown) => {
      console.warn('Failed to preload sandbox limits', error);
    }),
  head: () => ({
    meta: seo('sandboxes'),
  }),
  component: SandboxesPage,
});

function SandboxesPage() {
  const { id: organizationId } = Route.useParams();
  return (
    <SettingsPage>
      <EditorGroup>
        <SandboxesSettings organizationId={organizationId} />
      </EditorGroup>
    </SettingsPage>
  );
}
