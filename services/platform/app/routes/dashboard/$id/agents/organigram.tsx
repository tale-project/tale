import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { createFileRoute } from '@tanstack/react-router';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const OrganigramCanvas = lazyComponent(() =>
  import('@/app/features/agents/organigram/organigram-canvas').then((mod) => ({
    default: mod.OrganigramCanvas,
  })),
);

export const Route = createFileRoute('/dashboard/$id/agents/organigram')({
  head: () => ({
    meta: seo('agents'),
  }),
  // Warm the React Flow chunk during the loader (it's heavy).
  loader: () => {
    void import('@/app/features/agents/organigram/organigram-canvas');
  },
  component: OrganigramPage,
});

/**
 * Same page shape as the automations Metrics page: the agents layout's
 * breadcrumb ("Agents › Organigram") is the way back, so the content opens
 * with a plain title block instead of a PageHeader + back button.
 */
function OrganigramPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('organigram');
  const ability = useAbility();
  const canEdit = ability.can('read', 'developerSettings');

  return (
    <Stack gap={6} className="p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">{t('title')}</h1>
        <Text variant="caption" className="text-muted-foreground text-sm">
          {t('subtitle')}
        </Text>
      </div>
      <OrganigramCanvas organizationId={organizationId} canEdit={canEdit} />
    </Stack>
  );
}
