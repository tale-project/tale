import { createFileRoute } from '@tanstack/react-router';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { WebdavSettings } from '@/app/features/settings/webdav/components/webdav-settings';
import { ensureConvexQuery } from '@/app/lib/loader-preload';
import { useSiteUrl } from '@/lib/site-url-context';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/webdav')({
  head: () => ({ meta: seo('webdav') }),
  // Warm the app-passwords query before render so revisiting the page serves
  // cached rows instantly instead of refetching from scratch every visit
  // (mirrors the account/personalization routes).
  loader: ({ context, params }) => {
    void ensureConvexQuery(
      context,
      'webdav/app_password_queries:listAppPasswords',
      { organizationId: params.id },
    ).catch(console.warn);
  },
  component: ApiWebdavPage,
});

function ApiWebdavPage() {
  const { id: organizationId } = Route.useParams();
  const { data: organization } = useOrganization(organizationId);

  // Canonical deployment URL (SITE_URL), not the browser origin.
  const siteOrigin = useSiteUrl();
  const orgSlug = organization?.slug ?? organizationId;

  // Access is gated by the parent `api` route layout.
  return (
    <SettingsPage>
      <WebdavSettings
        organizationId={organizationId}
        orgSlug={orgSlug}
        siteOrigin={siteOrigin}
      />
    </SettingsPage>
  );
}
