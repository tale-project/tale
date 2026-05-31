import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { WebdavSettings } from '@/app/features/settings/webdav/components/webdav-settings';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
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

  // Canonical deployment URL (SITE_URL), not the browser's current origin —
  // the mount URL we show must be the one WebDAV clients should connect to,
  // which can differ from window.location (proxies, custom domains).
  const siteOrigin = useSiteUrl();
  const orgSlug = organization?.slug ?? organizationId;

  // Access is only knowable once the ability has loaded; until then the real
  // page renders (its app-password list self-skeletonizes), so there is no
  // denied-flash on warm entry and no bespoke skeleton to drift.
  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
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
