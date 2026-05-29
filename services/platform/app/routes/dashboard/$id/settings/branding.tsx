import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { QueryState } from '@/app/components/ui/query-state';
import { BrandingPageSkeleton } from '@/app/features/settings/branding/components/branding-page-skeleton';
import { BrandingSettings } from '@/app/features/settings/branding/components/branding-settings';
import { useBranding } from '@/app/features/settings/branding/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/branding')({
  head: () => ({
    meta: seo('branding'),
  }),
  component: BrandingSettingsPage,
});

function BrandingSettingsPage() {
  const { t } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const brandingQuery = useBranding();

  if (abilityLoading) {
    return <BrandingPageSkeleton />;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('branding')} />;
  }

  return (
    <QueryState query={brandingQuery} pending={<BrandingPageSkeleton />}>
      {(branding) => (
        <SettingsPage
          title={tNav('branding')}
          description={tSettings('menu.branding.description')}
        >
          <BrandingSettings
            branding={branding ?? undefined}
            onSaved={() => void brandingQuery.refetch()}
          />
        </SettingsPage>
      )}
    </QueryState>
  );
}
