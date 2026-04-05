import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { AutomationsActionMenu } from '@/app/features/automations/components/automations-action-menu';
import { AutomationsTable } from '@/app/features/automations/components/automations-table';
import { useAutomationsTableConfig } from '@/app/features/automations/hooks/use-automations-table-config';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
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
  const abilityLoading = useAbilityLoading();
  const { columns, searchPlaceholder } = useAutomationsTableConfig();

  if (abilityLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <DataTableSkeleton
          columns={columns}
          rows={5}
          searchPlaceholder={searchPlaceholder}
          noFirstColumnAvatar
          actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
        />
      </div>
    );
  }

  if (ability.cannot('write', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    <AutomationsTable organizationId={organizationId} currentFolder={folder} />
  );
}
