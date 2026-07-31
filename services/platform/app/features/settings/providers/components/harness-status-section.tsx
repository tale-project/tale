'use client';

/**
 * Read-only status of every shipped harness for this organization: how the
 * managed lane resolves for it (the direct-served model pool and the default
 * a turn falls back to), which vendor subscriptions are bound to it —
 * flagging an inert binding — and whether the health signal currently marks
 * it as failing.
 *
 * The configuration truth lives in the provider credentials on the other tabs;
 * this panel only SHOWS the resolution, so there is nothing here to edit.
 */

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Description } from '@tale/ui/description';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useT } from '@/lib/i18n/client';

import {
  useHarnessHealth,
  useHarnessStatus,
  type HarnessStatus,
} from '../hooks/queries';

interface HarnessStatusSectionProps {
  organizationId: string;
  /** Provider slug → display name, from the catalogs the page loaded. */
  displayNames: ReadonlyMap<string, string>;
}

function HarnessRow({
  row,
  degraded,
  displayNames,
}: {
  row: HarnessStatus;
  degraded: boolean;
  displayNames: ReadonlyMap<string, string>;
}) {
  const { t } = useT('settings');

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-foreground truncate text-sm font-medium">
          {row.label}
        </span>
        {degraded && (
          <Badge variant="orange">{t('providers.harnesses.degraded')}</Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.managed.available ? (
          <>
            <Badge variant="green">{t('providers.harnesses.managed')}</Badge>
            <span className="text-muted-foreground text-xs">
              {t('providers.harnesses.modelPool', {
                count: row.managed.modelCount,
                model: row.managed.defaultModelId,
              })}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">
            {row.managed.reason === 'byo-only'
              ? t('providers.harnesses.byoOnly')
              : t('providers.harnesses.noDirectCredential')}
          </span>
        )}
        {row.subscriptions.map((sub) => (
          <Badge
            key={sub.providerSlug}
            variant={sub.usable ? 'blue' : 'destructive'}
          >
            {t(
              sub.usable
                ? 'providers.harnesses.subscriptionVia'
                : 'providers.harnesses.subscriptionInert',
              {
                provider:
                  displayNames.get(sub.providerSlug) ?? sub.providerSlug,
              },
            )}
          </Badge>
        ))}
      </div>
    </li>
  );
}

export function HarnessStatusSection({
  organizationId,
  displayNames,
}: HarnessStatusSectionProps) {
  const { t } = useT('settings');
  const statusQuery = useHarnessStatus(organizationId);
  const health = useHarnessHealth(organizationId);

  const degraded = new Set(
    (health.data ?? [])
      .filter((entry) => entry.degraded)
      .map((entry) => entry.harness),
  );

  return (
    // No section heading: this is a tab panel, and the tab strip already reads
    // "Harnesses" — a section titled the same thing right under it was the
    // label twice.
    <Stack gap={4}>
      <Description>{t('providers.harnesses.description')}</Description>
      {statusQuery.isError ? (
        <Alert
          variant="destructive"
          description={t('providers.harnesses.listFailed', {
            error: mapCredentialError(statusQuery.error),
          })}
        />
      ) : statusQuery.isPending ? (
        <Skeletonize loading>
          <SkeletonBox fullWidth>
            <div className="h-24 w-full rounded-lg" />
          </SkeletonBox>
        </Skeletonize>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {statusQuery.data.map((row) => (
            <HarnessRow
              key={row.slug}
              row={row}
              degraded={degraded.has(row.slug)}
              displayNames={displayNames}
            />
          ))}
        </ul>
      )}
    </Stack>
  );
}
