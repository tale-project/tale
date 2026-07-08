import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { useCatalogSync } from '@/app/components/catalog/use-catalog-sync';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SkillsActionMenu } from '@/app/features/skills/components/skills-action-menu';
import { SkillsCatalog } from '@/app/features/skills/components/skills-catalog';
import { useInvalidateSkills } from '@/app/features/skills/hooks/mutations';
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
  const navigate = useNavigate();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const invalidateSkills = useInvalidateSkills();
  // "Update built-in skills" — the shared per-domain catalog sync, hosted in
  // the Add menu like on the agents/integrations/automations pages.
  const { menuItem: syncMenuItem, dialog: syncDialog } = useCatalogSync({
    organizationId,
    domain: 'skills',
    onSynced: () => invalidateSkills(organizationId),
  });

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('skills')}
        description={tSettings('menu.skills.description')}
        action={
          <SkillsActionMenu
            organizationId={organizationId}
            // Deep-link the fresh bundle's detail panel via ?slug= — the same
            // mechanism the catalog uses for external links to a skill.
            onUploaded={(newSlug) =>
              void navigate({
                from: Route.fullPath,
                search: { slug: newSlug },
                replace: true,
              })
            }
            extraMenuItems={syncMenuItem ? [syncMenuItem] : []}
          />
        }
      >
        {syncDialog}
        <SkillsCatalog
          organizationId={organizationId}
          initialDetailSlug={slug ?? null}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
