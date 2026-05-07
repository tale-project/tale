'use client';

import { useQuery } from '@tanstack/react-query';

import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexClient } from '@/app/hooks/use-convex-client';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface RetentionEnvironmentPanelProps {
  organizationId: string;
}

interface EnvSnapshotEntry {
  category: string;
  kind: 'min' | 'max' | 'default';
  envName: string;
  source: 'metadata' | 'none';
  currentValue: string | null;
  applied: boolean;
}

/**
 * Read-only "Environment" admin panel for retention envs. Modeled after
 * Backstage's `@backstage/plugin-config-schema` browser plugin: lists
 * every retention-related env var the resolver currently considers,
 * its observed value (if any), and how it was bound.
 *
 * Operators can SEE what's wired but can't edit env from here — env
 * vars are set at container start time; this page is a diagnostic /
 * documentation surface.
 */
export function RetentionEnvironmentPanel({
  organizationId,
}: RetentionEnvironmentPanelProps) {
  const { t } = useT('governance');
  const convex = useConvexClient();
  const result = useQuery({
    queryKey: ['retention-env-snapshot', organizationId],
    queryFn: async () => {
      return convex.action(
        api.governance.retention_actions.getRetentionEnvSnapshotAction,
        { organizationId },
      );
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  if (result.isLoading) {
    return (
      <PageSection
        title={t('environment.title', 'Retention environment variables')}
        description={t(
          'environment.description',
          'Read-only view of every retention-related env var the platform currently observes.',
        )}
      >
        <Text variant="muted">{t('environment.loading', 'Loading…')}</Text>
      </PageSection>
    );
  }

  if (result.isError) {
    return (
      <PageSection
        title={t('environment.title', 'Retention environment variables')}
      >
        <Text className="text-destructive">
          {t('environment.error', 'Failed to load environment snapshot.')}
        </Text>
      </PageSection>
    );
  }

  const entries = (result.data ?? []) as EnvSnapshotEntry[];
  // Group by category for readable display.
  const byCategory = new Map<string, EnvSnapshotEntry[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  const categoryNames = Array.from(byCategory.keys()).sort();

  return (
    <PageSection
      title={t('environment.title', 'Retention environment variables')}
      description={t(
        'environment.description',
        'Read-only view of every retention-related env var the platform currently observes. Set values via your platform container env (Compose / Helm / Terraform); they take effect on the next platform boot.',
      )}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-border border-b text-left">
              <th className="px-3 py-2 font-medium">
                {t('environment.column.category', 'Category')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('environment.column.envName', 'Env name')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('environment.column.source', 'Source')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('environment.column.value', 'Current value')}
              </th>
              <th className="px-3 py-2 font-medium">
                {t('environment.column.applied', 'Applied')}
              </th>
            </tr>
          </thead>
          <tbody>
            {categoryNames.map((cat) =>
              (byCategory.get(cat) ?? []).map((e) => (
                <tr
                  key={`${cat}.${e.kind}`}
                  className="border-border/50 border-b last:border-b-0"
                >
                  <td className="px-3 py-2">
                    <code className="text-xs">
                      {cat}.{e.kind}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    <code className="text-xs">{e.envName}</code>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.source === 'metadata'
                      ? t(
                          'environment.source.metadata',
                          'JSON _metadata.envNames',
                        )
                      : t('environment.source.none', 'No env binding')}
                  </td>
                  <td className="px-3 py-2">
                    {e.currentValue === null ? (
                      <Text variant="muted" className="text-xs">
                        {t('environment.value.unset', '(unset)')}
                      </Text>
                    ) : (
                      <code className="text-xs">{e.currentValue}</code>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.applied
                      ? t('environment.applied.yes', 'Yes')
                      : t('environment.applied.no', 'No')}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </PageSection>
  );
}
