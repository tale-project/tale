import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { AutomationsTable } from '@/app/features/automations/components/automations-table';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  folder: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/automations/')({
  head: () => ({
    meta: seo('automations'),
  }),
  validateSearch: searchSchema,
  component: AutomationsPage,
});

function AutomationsPage() {
  const { id: organizationId } = Route.useParams();
  const { folder } = Route.useSearch();
  const { t } = useT('accessDenied');

  const ability = useAbility();

  if (ability.cannot('write', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    <AutomationsTable organizationId={organizationId} currentFolder={folder} />
  );
}
