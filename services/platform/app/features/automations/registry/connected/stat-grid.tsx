'use client';

/**
 * Connected `StatGrid` block — binds an allowlisted query and renders a strip
 * of headline metrics over the `@tale/ui` StatCardGrid: each stat reads a
 * dot-notation `valueField` out of the query result, formats it via Intl on
 * the active locale, and optionally shows a period-over-period trend
 * (`trendField` → the previous value) and a sparkline (`sparklineField` → a
 * number series). Framed by `BlockFrame`/`BindingStates`; the loading state is
 * the real grid inside `<Skeletonize>` (granular masking, height-stable).
 *
 * Also home to the small pure helpers the other value-mapping blocks share
 * (`getValueAtPath`, `formatStatValue`) — the sibling-import pattern.
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Sparkline } from '@tale/ui/sparkline';
import { StatCard, StatCardGrid } from '@tale/ui/stat-card-grid';
import { Text } from '@tale/ui/text';
import { TrendIndicator } from '@tale/ui/trend-indicator';
import { Gauge } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import {
  argsReferenceProjectId,
  argsReferenceViewState,
} from '@/lib/shared/platform/function_bindings';
import {
  resolveLocalizedProp,
  type PackI18nMap,
} from '@/lib/shared/utils/resolve-automation-locale';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { BindingStates, BlockFrame } from '../block-frame';

/**
 * Read a dot-notation path (e.g. `countsByStatus.in_progress`) out of a
 * record tree. A literal key containing dots wins over path traversal;
 * `undefined` when any segment is missing or not a record.
 */
export function getValueAtPath(data: unknown, path: string): unknown {
  if (isRecord(data) && path in data) return data[path];
  let cur: unknown = data;
  for (const segment of path.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[segment];
  }
  return cur;
}

/** Locale-aware ms duration: picks the largest readable unit via Intl. */
function formatDurationMs(ms: number, locale: string): string {
  const abs = Math.abs(ms);
  const unit = (u: string, v: number) =>
    formatNumber(v, locale, {
      style: 'unit',
      unit: u,
      unitDisplay: 'narrow',
      maximumFractionDigits: 1,
    });
  if (abs < 1000) return unit('millisecond', ms);
  if (abs < 60_000) return unit('second', ms / 1000);
  if (abs < 3_600_000) return unit('minute', ms / 60_000);
  return unit('hour', ms / 3_600_000);
}

/**
 * Format one stat value for display. Strings pass through (a query may
 * pre-format), non-finite/missing values render an em-dash. `percent` treats
 * the value as 0–100 (the platform's rate metrics, e.g. intervention rate);
 * `duration` as milliseconds; `cents` as integer USD cents.
 */
export function formatStatValue(
  value: unknown,
  format: StatSpec['format'],
  locale: string,
): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'percent':
      return formatNumber(value / 100, locale, {
        style: 'percent',
        maximumFractionDigits: 1,
      });
    case 'duration':
      return formatDurationMs(value, locale);
    case 'cents':
      return formatCostCents(value, 'USD', locale);
    default:
      return formatNumber(value, locale);
  }
}

export interface StatSpec {
  /** Literal display label, rendered verbatim. */
  labelKey: string;
  /** Per-locale overrides for `labelKey`. */
  i18n?: PackI18nMap;
  /** Dot-notation path into the query result. */
  valueField: string;
  format?: 'number' | 'percent' | 'duration' | 'cents';
  /** Path to the previous-period value (period-over-period delta). */
  trendField?: string;
  /** Path to a number series (oldest → newest). */
  sparklineField?: string;
}

export interface StatGridProps {
  /** Optional block title (literal; schema passthrough). */
  title?: string;
  /** Per-locale overrides for the block `title` (`i18n.de.title`, …). */
  i18n?: PackI18nMap;
  query: { path: string; args?: unknown };
  /** Grid column count — the StatCardGrid strip supports 2 or 4 (default 4). */
  cols?: number;
  stats: StatSpec[];
}

function StatGridCards({
  stats,
  record,
  cols,
}: {
  stats: StatSpec[];
  record: Record<string, unknown> | undefined;
  cols?: number;
}) {
  const { locale } = useLocale();
  return (
    <StatCardGrid cols={cols === 2 ? 2 : 4}>
      {stats.map((stat, i) => {
        const value = getValueAtPath(record, stat.valueField);
        const current = typeof value === 'number' ? value : undefined;
        const prevRaw = stat.trendField
          ? getValueAtPath(record, stat.trendField)
          : undefined;
        const sparkRaw = stat.sparklineField
          ? getValueAtPath(record, stat.sparklineField)
          : undefined;
        const spark = Array.isArray(sparkRaw)
          ? sparkRaw.filter((n): n is number => typeof n === 'number')
          : [];
        return (
          <StatCard
            key={`${i}-${stat.valueField}`}
            label={
              resolveLocalizedProp(stat.labelKey, stat.i18n, 'label', locale) ??
              stat.labelKey
            }
            value={formatStatValue(value, stat.format, locale)}
          >
            {(stat.trendField && current !== undefined) || spark.length > 1 ? (
              <Stack gap={1} className="mt-0.5">
                {stat.trendField && current !== undefined ? (
                  <TrendIndicator
                    value={current}
                    previous={typeof prevRaw === 'number' ? prevRaw : null}
                  />
                ) : null}
                {spark.length > 1 ? (
                  <Sparkline data={spark} filled className="mt-1" />
                ) : null}
              </Stack>
            ) : null}
          </StatCard>
        );
      })}
    </StatCardGrid>
  );
}

export function StatGrid({ title, i18n, query, cols, stats }: StatGridProps) {
  const { locale } = useLocale();
  const { t } = useT('automations');
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    query.path,
    query.args,
  );
  const awaitingState = needsConfig && argsReferenceViewState(query.args);
  const needsProject =
    needsConfig && !awaitingState && argsReferenceProjectId(query.args);
  const record = isRecord(data) ? data : undefined;

  return (
    <BlockFrame
      title={resolveLocalizedProp(title, i18n, 'title', locale) ?? title}
      icon={Gauge}
    >
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaitingState && !needsProject}
        needsProject={needsProject}
        awaitingState={awaitingState}
        loading={isLoading && record === undefined}
        skeleton={
          <Skeletonize loading>
            <StatGridCards stats={stats} record={undefined} cols={cols} />
          </Skeletonize>
        }
      >
        {record === undefined ? (
          // A no-access query resolves to null — degrade to the shared empty
          // notice instead of a strip of dashes (or a crash).
          <Text variant="muted">{t('binding.empty')}</Text>
        ) : (
          <StatGridCards stats={stats} record={record} cols={cols} />
        )}
      </BindingStates>
    </BlockFrame>
  );
}

/** Registry entry (`registerConnectedBlock('StatGrid', statGridBlock)`). */
export const statGridBlock: {
  fields: Fields;
  render: PuckComponent<Partial<StatGridProps>>;
} = {
  fields: { title: { type: 'text' } },
  render: ({ title, i18n, query, cols, stats }) =>
    query?.path && stats && stats.length > 0 ? (
      <StatGrid
        title={title}
        i18n={i18n}
        query={query}
        cols={cols}
        stats={stats}
      />
    ) : (
      <></>
    ),
};
