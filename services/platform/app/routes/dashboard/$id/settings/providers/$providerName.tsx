import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ProvidersTable } from '@/app/features/settings/providers/components/providers-table';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  component: ProviderDetailRoute,
});

function ProviderDetailRoute() {
  const { id, providerName } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  // The provider detail page was collapsed into a right-side drawer opened
  // from the providers list — but the deep-link URL is preserved. Render the
  // list page with the drawer auto-opened for the requested provider so
  // bookmarks and links keep working without redirects. Wrap in the same
  // `SettingsPage` chrome as the index route so the title/description header
  // is identical on both routes (no shift when navigating between them, and
  // none when the layout-route skeleton hands off to this view).
  return (
    <SettingsPage
      title={tNav('providers')}
      description={tSettings('menu.providers.description')}
    >
      <ProvidersTable
        organizationId={id}
        initialDetailProvider={providerName}
      />
    </SettingsPage>
  );
}
