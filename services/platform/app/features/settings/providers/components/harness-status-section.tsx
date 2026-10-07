'use client';

/**
 * Read-only status of every managed-capable shipped harness for this
 * organization: how the managed lane resolves for it (the direct-served
 * model pool and the default a turn falls back to), which vendor
 * subscriptions are bound to it — flagging an inert binding — and whether
 * the health signal currently marks it as failing. A health signal that could
 * not be read says so, rather than leave every runtime unmarked.
 *
 * Bring-your-own-only harnesses are omitted upstream; this panel only SHOWS
 * the resolution for harnesses the org can actually configure above.
 */

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useRef } from 'react';

import { readStateOf } from '@/app/lib/backend/read-state';
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

const LOADING_HARNESSES: HarnessStatus[] = Array.from(
  { length: 3 },
  (_, i) => ({
    slug: `loading-${i}`,
    label: 'Harness',
    managed: { available: true, modelCount: 1, defaultModelId: 'model' },
    subscriptions: [],
  }),
);

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
        <SkeletonBox asChild>
          <span className="text-foreground truncate text-sm font-medium">
            {row.label}
          </span>
        </SkeletonBox>
        {degraded && (
          <Badge variant="orange">{t('providers.harnesses.degraded')}</Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {row.managed.available ? (
          <SkeletonBox asChild>
            <span className="text-muted-foreground text-xs">
              {t('providers.harnesses.modelPool', {
                count: row.managed.modelCount,
                model: row.managed.defaultModelId,
              })}
            </span>
          </SkeletonBox>
        ) : (
          // The way out (add a credential above) is said once, over the
          // list; each runtime only says where it stands.
          <SkeletonBox asChild>
            <span className="text-muted-foreground text-xs">
              {t('providers.harnesses.noModel')}
            </span>
          </SkeletonBox>
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
  const { refetch: refetchHealth } = health;
  // A health read that failed is not a runtime without failures (#3891): it
  // used to clear every "Recently failing" badge, with nothing to say so.
  const healthRead = readStateOf(health);

  // When the health read comes back, its alert and Try again leave the page;
  // the runtime list, where the answer shows, takes the focus instead.
  const listRef = useRef<HTMLUListElement>(null);
  const focusList = useCallback(() => {
    listRef.current?.focus();
  }, []);

  const degraded = new Set(
    (health.data ?? [])
      .filter((entry) => entry.degraded)
      .map((entry) => entry.harness),
  );

  return (
    // Neither heading nor description: the enclosing `SettingsSection` renders
    // both. This used to be a tab panel and carried its own description, which
    // became the same sentence twice once the tab became a section.
    <Stack gap={4}>
      {/* Over the rows it qualifies; a failed status read says enough. */}
      {!statusQuery.isError && (healthRead.unavailable || healthRead.stale) && (
        <CatalogLoadError
          // Each failure is announced again; Try again keeps its node, and
          // the focus on it, through a retry that fails again.
          failureKey={healthRead.failureCount}
          onFocusLost={focusList}
          message={t(
            healthRead.stale
              ? 'providers.harnesses.healthRefreshFailed'
              : 'providers.harnesses.healthLoadFailed',
          )}
          onRetry={() => void refetchHealth()}
          isRetrying={healthRead.retrying}
        />
      )}
      {statusQuery.isError ? (
        <CatalogLoadError
          message={t('providers.harnesses.listFailed')}
          onRetry={() => void statusQuery.refetch()}
        />
      ) : (
        <Skeletonize loading={statusQuery.isPending}>
          {!statusQuery.isPending &&
            statusQuery.data.some(
              (row) =>
                !row.managed.available &&
                row.managed.reason === 'no-direct-credential',
            ) && (
              <Text variant="muted" className="text-sm">
                {t('providers.harnesses.noDirectCredential')}
              </Text>
            )}
          {/* Models are direct-served, but none a runtime can carry: adding
              a credential would not help, another model or Codex would. */}
          {!statusQuery.isPending &&
            statusQuery.data.some(
              (row) =>
                !row.managed.available &&
                row.managed.reason === 'no-compatible-model',
            ) && (
              <Text variant="muted" className="text-sm">
                {t('providers.harnesses.noCompatibleModel')}
              </Text>
            )}
          <ul
            ref={listRef}
            // Named and focusable (not tabbable) for the focus hand-off above.
            aria-label={t('providers.harnesses.title')}
            tabIndex={-1}
            className="border-border divide-border divide-y rounded-lg border outline-none"
          >
            {(statusQuery.isPending ? LOADING_HARNESSES : statusQuery.data).map(
              (row) => (
                <HarnessRow
                  key={row.slug}
                  row={row}
                  degraded={degraded.has(row.slug)}
                  displayNames={displayNames}
                />
              ),
            )}
          </ul>
        </Skeletonize>
      )}
    </Stack>
  );
}
