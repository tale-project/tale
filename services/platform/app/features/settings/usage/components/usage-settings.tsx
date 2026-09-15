'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { EmptyState } from '@tale/ui/empty-state';
import { ProgressBar } from '@tale/ui/progress-bar';
import { SKELETON_PULSE, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import type { ReactNode } from 'react';

import { useUploadUsage } from '@/app/features/documents/hooks/queries';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import {
  type MyBudgetUsageLimit,
  useMyBudgetUsage,
} from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

type Metric = 'tokens' | 'costCents' | 'requests';

/** The order the budget editor lists a rule's limits in. */
const METRICS: readonly Metric[] = ['tokens', 'costCents', 'requests'];

/** One capped dimension of one budget bucket — a meter on the page. */
interface MeterRow {
  key: string;
  metric: Metric;
  limit: MyBudgetUsageLimit;
  used: number;
  cap: number;
}

function toMeterRows(limits: readonly MyBudgetUsageLimit[]): MeterRow[] {
  return limits.flatMap((limit) =>
    METRICS.flatMap((metric) => {
      const meter = limit[metric];
      if (meter === null) return [];
      return [
        {
          key: `${limit.scope}:${limit.teamId ?? ''}:${limit.period}:${metric}`,
          metric,
          limit,
          used: meter.used,
          cap: meter.limit,
        },
      ];
    }),
  );
}

/** Rows masked while the first read is in flight. */
const PLACEHOLDER_ROWS = 2;

interface UsageSettingsProps {
  organizationId: string;
}

/**
 * The member's own usage page: every budget cap that binds them, measured
 * the way the gate measures it, plus their storage quota. Personal caps and
 * shared caps (a team's, the organization's) are separate sections because a
 * shared cap fills with other people's usage too.
 */
export function UsageSettings({ organizationId }: UsageSettingsProps) {
  const { t } = useT('settings');
  const ability = useAbility();
  const { data: limits, isLoading, isError } = useMyBudgetUsage(organizationId);

  const rows = toMeterRows(limits ?? []);
  const personal = rows.filter((row) => row.limit.scope === 'user');
  const shared = rows.filter((row) => row.limit.scope !== 'user');
  const showPersonal = isLoading || personal.length > 0;
  const showFallback = !isLoading && (isError || rows.length === 0);

  const manageLimits = ability.can('read', 'orgSettings') ? (
    <Button asChild variant="secondary" size="sm">
      <Link
        to="/dashboard/$id/settings/governance/policies-limits"
        params={{ id: organizationId }}
      >
        {t('usage.manageLimits')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <SettingsPage>
      {showPersonal && (
        <Skeletonize loading={isLoading} label={t('usage.personal.title')}>
          <SettingsSection
            title={t('usage.personal.title')}
            description={t('usage.personal.description')}
            action={manageLimits}
          >
            <SettingsFieldList>
              {isLoading
                ? Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
                    <PlaceholderMeterRow key={index} seed={index * 3} />
                  ))
                : personal.map((row) => (
                    <UsageMeterRow key={row.key} row={row} />
                  ))}
            </SettingsFieldList>
          </SettingsSection>
        </Skeletonize>
      )}

      {shared.length > 0 && (
        <SettingsSection
          title={t('usage.shared.title')}
          description={t('usage.shared.description')}
          action={personal.length === 0 ? manageLimits : undefined}
        >
          <SettingsFieldList>
            {shared.map((row) => (
              <UsageMeterRow key={row.key} row={row} />
            ))}
          </SettingsFieldList>
        </SettingsSection>
      )}

      {showFallback && (
        <SettingsSection
          title={t('usage.limits.title')}
          description={t('usage.limits.description')}
          action={manageLimits}
        >
          {isError ? (
            <p role="alert" className="text-destructive text-sm">
              {t('usage.loadFailed')}
            </p>
          ) : (
            <EmptyState
              icon={Gauge}
              title={t('usage.empty.title')}
              description={t('usage.empty.description')}
              className="border-border rounded-lg border px-5 py-10"
            />
          )}
        </SettingsSection>
      )}

      <StorageSection organizationId={organizationId} />
    </SettingsPage>
  );
}

function UsageMeterRow({ row }: { row: MeterRow }) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const { formatNumber, formatCostCents } = useFormatNumber();

  const format = (value: number) =>
    row.metric === 'costCents'
      ? formatCostCents(value)
      : formatNumber(Math.round(value));
  const period = { period: row.limit.period };
  const label =
    row.metric === 'tokens'
      ? t('usage.metric.tokens', period)
      : row.metric === 'costCents'
        ? t('usage.metric.costCents', period)
        : t('usage.metric.requests', period);

  const date = formatDate(new Date(row.limit.resetsAt), 'long');
  const description =
    row.limit.scope === 'org'
      ? t('usage.organizationScope', { date })
      : row.limit.scope === 'team'
        ? row.limit.teamName
          ? t('usage.teamScope', { team: row.limit.teamName, date })
          : t('usage.anyTeamScope', { date })
        : t('usage.resets', { date });

  return (
    <SettingsFieldRow label={label} description={description}>
      <UsageMeter
        label={label}
        used={row.used}
        cap={row.cap}
        usedText={format(row.used)}
        capText={format(row.cap)}
        warningThresholdPercent={row.limit.warningThresholdPercent}
      />
    </SettingsFieldRow>
  );
}

/**
 * "used of cap" over a bar. The bar takes the warning tint once usage passes
 * the threshold the budget banner warns at, and the destructive tint once the
 * cap is reached — the point the gate starts refusing.
 */
function UsageMeter({
  label,
  used,
  cap,
  usedText,
  capText,
  warningThresholdPercent,
}: {
  label: string;
  used: number;
  cap: number;
  usedText: string;
  capText: string;
  warningThresholdPercent: number | null;
}) {
  const { t } = useT('settings');
  const reached = used >= cap;
  const percent = cap > 0 ? (used / cap) * 100 : 100;
  const warning =
    !reached &&
    warningThresholdPercent !== null &&
    percent >= warningThresholdPercent;
  const summary = t('usage.usedOfLimit', { used: usedText, limit: capText });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-foreground text-sm tabular-nums">{summary}</span>
        {reached && (
          <span className="text-destructive text-xs font-medium">
            {t('usage.reached')}
          </span>
        )}
      </div>
      <ProgressBar
        value={used}
        max={cap}
        label={t('usage.meterLabel', {
          metric: label,
          used: usedText,
          limit: capText,
        })}
        tooltipContent={null}
        indicatorClassName={cn(
          reached ? 'bg-destructive' : warning ? 'bg-warning' : 'bg-primary',
        )}
      />
    </div>
  );
}

/** A meter row whose label, reset line and values are not known yet. */
function PlaceholderMeterRow({ seed }: { seed: number }) {
  return (
    <SettingsFieldRow
      label={
        <span className="block w-28">
          <SkeletonText seed={seed} />
        </span>
      }
      description={
        <span className="block w-56">
          <SkeletonText seed={seed + 1} />
        </span>
      }
    >
      <PlaceholderMeter seed={seed + 2} />
    </SettingsFieldRow>
  );
}

/** The meter's footprint — its summary line and bar — while it loads. */
function PlaceholderMeter({ seed }: { seed: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block w-32 text-sm">
        <SkeletonText seed={seed} />
      </span>
      <span
        aria-hidden
        className={cn('block h-1.5 w-full rounded-full', SKELETON_PULSE)}
      />
    </div>
  );
}

function StorageSection({ organizationId }: { organizationId: string }) {
  const { t } = useT('settings');
  const { locale } = useFormatNumber();
  const { data: storage, isLoading } = useUploadUsage(organizationId);
  const label = t('usage.storage.label');

  let body: ReactNode;
  if (storage?.limited && storage.limitBytes !== null) {
    body = (
      <SettingsFieldList>
        <SettingsFieldRow label={label}>
          <UsageMeter
            label={label}
            used={storage.usedBytes}
            cap={storage.limitBytes}
            usedText={formatBytes(storage.usedBytes, locale)}
            capText={formatBytes(storage.limitBytes, locale)}
            warningThresholdPercent={null}
          />
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  } else if (isLoading) {
    // Most organizations cap storage (the default upload policy does), so
    // the first paint takes the metered shape.
    body = (
      <SettingsFieldList>
        <SettingsFieldRow label={label}>
          <PlaceholderMeter seed={PLACEHOLDER_ROWS * 3} />
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  } else {
    body = (
      <p className="text-muted-foreground text-sm">
        {t('usage.storage.unlimited')}
      </p>
    );
  }

  return (
    <Skeletonize loading={isLoading} label={t('usage.storage.title')}>
      <SettingsSection
        title={t('usage.storage.title')}
        description={t('usage.storage.description')}
      >
        {body}
      </SettingsSection>
    </Skeletonize>
  );
}
