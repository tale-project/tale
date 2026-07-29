import { createFileRoute } from '@tanstack/react-router';

import { EditorGroup } from '@/app/components/ui/editor';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { DefaultModelEditor } from '@/app/features/settings/governance/components/default-model-editor';
import { ModelAccessEditor } from '@/app/features/settings/governance/components/model-access-editor';
import { ensureGovernancePolicies } from '@/app/lib/loader-preload';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/content-models',
)({
  // Warm every policy this page reads so editors paint their REAL content on
  // first render (no skeleton flash, no staggered reveal). `.catch` so a
  // transient/auth error never blocks the transition — the editors' own
  // loading + access checks still render correctly.
  loader: ({ context, params }) =>
    ensureGovernancePolicies(context, params.id, [
      'default_models',
      'model_access',
    ]).catch((error: unknown) => {
      console.warn('Failed to preload content-models policies', error);
    }),
  component: ContentModelsRoute,
});

function ContentModelsRoute() {
  const { id: organizationId } = Route.useParams();

  // Editors are eager-imported (not lazy) so they share one coordinated reveal
  // under the page's skeletonization — a lazy chunk's inner Suspense fallback
  // would otherwise let one editor pop in alone.
  return (
    <SettingsPage>
      <EditorGroup>
        <DefaultModelEditor organizationId={organizationId} />
        <ModelAccessEditor organizationId={organizationId} />
      </EditorGroup>
    </SettingsPage>
  );
}
