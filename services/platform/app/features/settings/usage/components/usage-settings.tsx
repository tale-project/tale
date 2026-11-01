'use client';

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { EmptyState } from '@tale/ui/empty-state';
import { ProgressBar } from '@tale/ui/progress-bar';
import { SKELETON_PULSE, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import { type ReactNode, useCallback, useId, useRef } from 'react';

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
import { readStateOf } from '@/app/lib/backend/read-state';
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
  // Until the read answers, the page takes the shape most members get: an
  // organization sets no budget by default, so the first paint is the "Usage
  // limits" section with its empty state masked in place — never the claim
  // that nothing applies, and no heading that swaps when nothing does. The
  // storage meter below reasons the same way.
  const showFallback = isLoading || isError || rows.length === 0;

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
      {personal.length > 0 && (
        <SettingsSection
          title={t('usage.personal.title')}
          description={t('usage.personal.description')}
          action={manageLimits}
        >
          <SettingsFieldList>
            {personal.map((row) => (
              <UsageMeterRow key={row.key} row={row} />
            ))}
          </SettingsFieldList>
        </SettingsSection>
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
        <Skeletonize loading={isLoading} label={t('usage.limits.title')}>
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
                title={
                  isLoading ? (
                    <span className="inline-block w-48">
                      <SkeletonText />
                    </span>
                  ) : (
                    t('usage.empty.title')
                  )
                }
                description={
                  isLoading ? (
                    <span className="block w-64 max-w-full">
                      <SkeletonText lines={2} seed={1} />
                    </span>
                  ) : (
                    t('usage.empty.description')
                  )
                }
                className="border-border rounded-lg border px-5 py-10"
              />
            )}
          </SettingsSection>
        </Skeletonize>
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

type UploadUsage = NonNullable<ReturnType<typeof useUploadUsage>['data']>;

/**
 * What fills the meter, from the rows it counts (the parts add up to it), and
 * where those files live: the viewer's own documents in Knowledge, and the
 * chats that hold the rest, largest first.
 */
function StorageBreakdown({
  organizationId,
  storage,
  locale,
}: {
  organizationId: string;
  storage: UploadUsage;
  locale: string;
}) {
  const { t } = useT('settings');
  const { t: tChat } = useT('chat');
  const { breakdown, chats, chatCount } = storage;
  const chatsLabelId = useId();
  const parts = [
    {
      key: 'documents',
      label: t('usage.storage.breakdown.documents'),
      bytes: breakdown.documents,
    },
    {
      key: 'chatAttachments',
      label: t('usage.storage.breakdown.chatAttachments'),
      bytes: breakdown.chatAttachments,
    },
    {
      key: 'agentFiles',
      label: t('usage.storage.breakdown.agentFiles'),
      bytes: breakdown.agentFiles,
    },
    // Files that are none of the above (an upload no document took over and
    // no chat holds) are named only when there are some.
    ...(breakdown.other > 0
      ? [
          {
            key: 'other',
            label: t('usage.storage.breakdown.other'),
            bytes: breakdown.other,
          },
        ]
      : []),
  ];
  const linkClass =
    'text-foreground underline underline-offset-4 hover:text-primary';

  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {parts.map((part) => (
          <div key={part.key} className="contents">
            <dt className="text-muted-foreground">{part.label}</dt>
            <dd className="text-right tabular-nums">
              {formatBytes(part.bytes, locale)}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        to="/dashboard/$id/documents"
        params={{ id: organizationId }}
        search={{ uploadedBy: 'me' }}
        className={cn('self-start', linkClass)}
      >
        {t('usage.storage.viewDocuments')}
      </Link>
      {chats.length > 0 && (
        <div className="flex flex-col gap-1">
          <p id={chatsLabelId} className="font-medium">
            {t('usage.storage.chats.label')}
          </p>
          <ul aria-labelledby={chatsLabelId} className="flex flex-col gap-1">
            {chats.map((chat) => (
              <li key={chat.threadId} className="flex items-baseline gap-4">
                <Link
                  to="/dashboard/$id/chat/$threadId"
                  params={{ id: organizationId, threadId: chat.threadId }}
                  className={cn('min-w-0 flex-1 truncate', linkClass)}
                >
                  {chat.title ?? tChat('history.untitled')}
                </Link>
                <span className="text-muted-foreground tabular-nums">
                  {formatBytes(chat.bytes, locale)}
                </span>
              </li>
            ))}
          </ul>
          {chatCount > chats.length && (
            <p className="text-muted-foreground">
              {t('usage.storage.chats.more', {
                count: chatCount - chats.length,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The member's upload quota. A failed read says so, with **Try again**, and
 * never reads as "no storage limit" (#4832): that sentence is a read that
 * answered with no limit.
 */
function StorageSection({ organizationId }: { organizationId: string }) {
  const { t } = useT('settings');
  const { locale } = useFormatNumber();
  const storageQuery = useUploadUsage(organizationId);
  const { data: storage, refetch } = storageQuery;
  const { unavailable, stale, retrying, failureCount } =
    readStateOf(storageQuery);
  const label = t('usage.storage.label');
  // Masked until the read answers. A failed read is not masked, also while
  // Try again runs (react-query puts it back to pending then): its notice
  // stays readable.
  const loading = storage === undefined && !unavailable;

  // A retry that works takes the notice away, and with it a Try again that
  // held the focus: the focus goes to the section, which keeps its name,
  // instead of dropping to the page.
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = useCallback(() => {
    sectionRef.current?.focus();
  }, []);

  let body: ReactNode = null;
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
        <SettingsFieldRow label={t('usage.storage.breakdown.label')}>
          <StorageBreakdown
            organizationId={organizationId}
            storage={storage}
            locale={locale}
          />
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  } else if (loading) {
    // Most organizations cap storage (the default upload policy does), so
    // the first paint takes the metered shape.
    body = (
      <SettingsFieldList>
        <SettingsFieldRow label={label}>
          <PlaceholderMeter seed={6} />
        </SettingsFieldRow>
      </SettingsFieldList>
    );
  } else if (storage !== undefined) {
    body = (
      <p className="text-muted-foreground text-sm">
        {t('usage.storage.unlimited')}
      </p>
    );
  }

  return (
    <Skeletonize loading={loading} label={t('usage.storage.title')}>
      <SettingsSection
        ref={sectionRef}
        tabIndex={-1}
        className="outline-none"
        title={t('usage.storage.title')}
        description={t('usage.storage.description')}
      >
        {(unavailable || stale) && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node, and
            // the focus on it, while a retry runs and when it fails again.
            failureKey={failureCount}
            onFocusLost={focusSection}
            message={t(
              stale
                ? 'usage.storage.refreshFailed'
                : 'usage.storage.loadFailed',
            )}
            onRetry={() => void refetch()}
            isRetrying={retrying}
          />
        )}
        {body}
      </SettingsSection>
    </Skeletonize>
  );
}
