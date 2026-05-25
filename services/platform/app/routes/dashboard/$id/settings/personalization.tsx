import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { PersonalizationSettings } from '@/app/features/settings/personalization/components/personalization-settings';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/personalization')(
  {
    head: () => ({
      meta: seo('personalization'),
    }),
    component: PersonalizationPage,
  },
);

function PersonalizationPage() {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  return (
    <SettingsPage
      title={tNav('personalization')}
      description={tSettings('menu.personalization.description')}
    >
      <PersonalizationSettings />
    </SettingsPage>
  );
}
