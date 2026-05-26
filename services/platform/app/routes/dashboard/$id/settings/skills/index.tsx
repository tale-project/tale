import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/skills/')({
  head: () => ({
    meta: seo('skills'),
  }),
  component: SkillsPage,
});

function SkillsPage() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return (
    <SettingsPage
      title={tNav('skills')}
      description={tSettings('menu.skills.description')}
    >
      <SkillsTable organizationId={organizationId} />
    </SettingsPage>
  );
}
