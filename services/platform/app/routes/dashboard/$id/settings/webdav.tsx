import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsListPageSkeleton } from '@/app/features/settings/components/settings-skeleton';
import { WebdavSettings } from '@/app/features/settings/webdav/components/webdav-settings';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
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
  const { t: tAccess } = useT('accessDenied');

  // WebDAV app-passwords are PAT-equivalent — gate on the same
  // `developerSettings` capability as API keys. Backend mutation
  // (`createAppPassword`) enforces this independently via
  // `requireOrgAdminOrDeveloper`; this is the UI-side feedback.
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const siteOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';
  const orgSlug = organization?.slug ?? organizationId;

  if (abilityLoading) {
    return <SettingsListPageSkeleton />;
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccess('webdav')} />;
  }

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
