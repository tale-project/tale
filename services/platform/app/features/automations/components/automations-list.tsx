'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, CircleDashed, Workflow } from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomations } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import { automationSlugToParam } from '../lib/slug';

function ListLoading() {
  return (
    <Skeletonize loading>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
    </Skeletonize>
  );
}

/**
 * The organization's automations.
 *
 * Each row answers the only two questions the list can: how many versions exist,
 * and which one — if any — is live. An automation with versions but no
 * deployment is drafts only; saying so here is what stops someone waiting for a
 * schedule that was never promoted.
 */
export function AutomationsList({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('automations');
  const headingId = useId();
  const automationsQuery = useAutomations(organizationId);

  const automations = [...(automationsQuery.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} className="text-lg font-semibold">
          {t('title')}
        </h2>
        <Text as="p" variant="muted" className="text-sm">
          {t('list.description')}
        </Text>
      </div>

      {automationsQuery.isError && (
        <Alert
          variant="destructive"
          description={t('list.loadFailed', {
            error: automationErrorMessage(automationsQuery.error),
          })}
        />
      )}

      {automationsQuery.isPending && !automationsQuery.isError && (
        <ListLoading />
      )}

      {automationsQuery.data !== undefined &&
        (automations.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title={t('list.empty.title')}
            description={t('list.empty.description')}
            headingLevel={2}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {automations.map((automation) => {
              // The listing omits `deployedVersion` entirely for an automation
              // that has no deployment, so its absence IS the "drafts only"
              // answer rather than a missing field.
              const deployedVersion =
                'deployedVersion' in automation
                  ? automation.deployedVersion
                  : undefined;
              return (
                <li key={automation.name}>
                  <Link
                    to="/dashboard/$id/automations/$automationSlug"
                    params={{
                      id: organizationId,
                      automationSlug: automationSlugToParam(automation.name),
                    }}
                    className="border-border bg-card hover:bg-muted/50 focus-visible:ring-ring flex flex-wrap items-center gap-3 rounded-md border p-3 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {automation.name}
                    </span>
                    <Badge variant="slate">
                      {t('list.versionCount', { count: automation.latest })}
                    </Badge>
                    {deployedVersion === undefined ? (
                      <Badge variant="yellow" icon={CircleDashed}>
                        {t('list.notDeployed')}
                      </Badge>
                    ) : (
                      <Badge variant="green" icon={CheckCircle2}>
                        {t('detail.deployedVersion', {
                          version: deployedVersion,
                        })}
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
