import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SkillEditor } from '@/app/features/settings/skills/components/skill-editor';
import { SkillsCatalog } from '@/app/features/settings/skills/components/skills-catalog';
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

/**
 * The skill library: the catalog by default; `?slug=` swaps in that skill's
 * editor in place (deep-linkable, back returns to the catalog). One route so
 * a skill link is just a search param, matching the pre-rewrite URL shape.
 */
function SkillsPage() {
  const { id: organizationId } = Route.useParams();
  const { slug } = Route.useSearch();
  const navigate = useNavigate();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const openSkill = (nextSlug: string | null) =>
    void navigate({
      from: Route.fullPath,
      search: nextSlug ? { slug: nextSlug } : {},
      replace: true,
    });

  return (
    // The editor is a master-detail file browser — the one settings surface
    // that needs the documented full-measure escape AND stacked fields (its
    // controls size to the editor pane, not the settings control column);
    // the catalog keeps the shared narrow measure.
    <SettingsPage
      fullWidth={slug !== undefined}
      fieldLayout={slug !== undefined ? 'stacked' : 'row'}
      fitToContainer={slug !== undefined}
    >
      <SettingsSection
        title={tNav('skills')}
        description={tSettings('menu.skills.description')}
        className={slug !== undefined ? 'min-h-0 flex-1' : undefined}
      >
        {slug ? (
          <SkillEditor
            organizationId={organizationId}
            slug={slug}
            onBack={() => openSkill(null)}
            onDeleted={() => openSkill(null)}
          />
        ) : (
          <SkillsCatalog organizationId={organizationId} onOpen={openSkill} />
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
