import { createFileRoute } from '@tanstack/react-router';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { WebdavSettings } from '@/app/features/settings/webdav/components/webdav-settings';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/webdav')({
  head: () => ({ meta: seo('webdav') }),
  component: WebdavSettingsPage,
});

function WebdavSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { data: organization } = useOrganization(organizationId);
  const { t } = useT('webdav');
  const siteOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const orgSlug = organization?.slug ?? organizationId;
  return (
    <SettingsPage
      title={t('title', 'WebDAV')}
      description={t(
        'description',
        'Mount Tale documents as a network drive in Finder, File Explorer, or any WebDAV client.',
      )}
    >
      <WebdavSettings
        organizationId={organizationId}
        orgSlug={orgSlug}
        siteOrigin={siteOrigin}
      />
    </SettingsPage>
  );
}
