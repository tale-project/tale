import { createFileRoute } from '@tanstack/react-router';

import { ProvidersTable } from '@/app/features/settings/providers/components/providers-table';

export const Route = createFileRoute(
  '/dashboard/$id/settings/providers/$providerName',
)({
  component: ProviderDetailRoute,
});

function ProviderDetailRoute() {
  const { id, providerName } = Route.useParams();
  // The provider detail page was collapsed into a right-side drawer opened
  // from the providers list — but the deep-link URL is preserved. Render the
  // list page with the drawer auto-opened for the requested provider so
  // bookmarks and links keep working without redirects.
  return (
    <ProvidersTable organizationId={id} initialDetailProvider={providerName} />
  );
}
