import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SkillsTable } from '@/app/features/skills/components/skills-table';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const skillsSearchSchema = z.object({
  slug: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/skills/')({
  head: () => ({
    meta: seo('skills'),
  }),
  validateSearch: skillsSearchSchema,
  component: SkillsPage,
});

function SkillsPage() {
  const { id: organizationId } = Route.useParams();
  const { slug } = Route.useSearch();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return (
    <SettingsPage
      title={tNav('skills')}
      description={tSettings('menu.skills.description')}
    >
      <SkillsTable
        organizationId={organizationId}
        initialDetailSlug={slug ?? null}
      />
    </SettingsPage>
  );
}
