import { Row, Stack } from '@tale/ui/layout';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { AutomationsActionMenu } from '@/app/features/automations/components/automations-action-menu';
import { AutomationsTable } from '@/app/features/automations/components/automations-table';
import type { AutomationTableItem } from '@/app/features/automations/components/automations-table';
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
  // No loader prefetch: the filesystem-backed `listWorkflows` action requires
  // auth, and a route loader runs BEFORE the Convex WS auth handshake — on a
  // cold load it fired unauthenticated and logged `UNAUTHENTICATED` on every
  // nav. `useListWorkflows` (via AutomationsTable) is auth-gated and caches with
  // an infinite staleTime, so the table loads once auth is ready and stays warm
  // on subsequent navigations.
  component: AutomationsPage,
});

function AutomationsPage() {
  const { id: organizationId } = Route.useParams();
  const { folder } = Route.useSearch();
  const { t } = useT('accessDenied');
  const { t: tAutomations } = useT('automations');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { columns, searchPlaceholder } =
    useAutomationsTableConfig(organizationId);

  if (abilityLoading) {
    // The DataTable renders its own loading skeleton; mirror AutomationsTable's
    // header so the layout doesn't shift once the ability check resolves.
    return (
      <Stack className="p-4">
        <Row justify="between">
          <SearchInput
            wrapperClassName="w-full max-w-sm"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value=""
            onChange={() => {}}
            readOnly
          />
          <AutomationsActionMenu organizationId={organizationId} />
        </Row>
        <DataTable<AutomationTableItem>
          columns={columns}
          data={[]}
          isLoading
          approxRowCount={5}
          infiniteScroll={{
            hasMore: false,
            onLoadMore: () => {},
            entityLabel: tAutomations('entityLabel'),
            totalCount: 0,
          }}
        />
      </Stack>
    );
  }

  if (ability.cannot('write', 'wfDefinitions')) {
    return <AccessDenied message={t('automations')} />;
  }

  return (
    <AutomationsTable organizationId={organizationId} currentFolder={folder} />
  );
}
