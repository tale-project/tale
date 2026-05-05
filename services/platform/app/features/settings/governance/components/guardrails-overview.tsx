'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Copy, Info, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import {
  chatFilterConfigSchema,
  moderationProviderConfigSchema,
  piiConfigSchema,
} from '@/lib/shared/schemas/governance';

import { useGovernancePolicy } from '../hooks/queries';

interface RecentEvent {
  _id: string;
  organizationId: string;
  sanitizationRunId: string;
  threadId: string;
  messageId?: string;
  filterName: 'pii' | 'chat_filter' | 'moderation_provider';
  direction: 'input' | 'output';
  kind: 'detected' | 'blocked' | 'step_error' | 'circuit_open';
  categoryIds: string[];
  matchCount?: number;
  truncated?: boolean;
  errorClass?: string;
  httpStatus?: number;
  durationMs?: number;
  attempt?: number;
  agentSlug?: string;
  actorType?: string;
  createdAt: number;
}

interface GuardrailsOverviewProps {
  organizationId: string;
}

interface StatusCardProps {
  title: string;
  description: string;
  enabled: boolean;
  details: string[];
  disabledReason: string;
  icon: LucideIcon;
}

function StatusCard({
  title,
  description,
  enabled,
  details,
  disabledReason,
  icon: Icon,
}: StatusCardProps) {
  const { t: tCommon } = useT('common');
  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon
          className={
            enabled ? 'size-4 text-emerald-600' : 'text-muted-foreground size-4'
          }
          aria-hidden
        />
        <div className="font-medium">{title}</div>
      </div>
      <div className="text-muted-foreground mb-3 text-xs">{description}</div>
      {enabled ? (
        <ul className="text-xs">
          {details.map((detail) => (
            <li key={detail} className="py-0.5">
              {detail}
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2">
          <Badge variant="outline" icon={Info} className="mt-auto">
            {tCommon('status.disabled')}
          </Badge>
          <p className="text-muted-foreground text-xs">{disabledReason}</p>
        </div>
      )}
    </div>
  );
}

export function GuardrailsOverview({
  organizationId,
}: GuardrailsOverviewProps) {
  const { t } = useT('governance');
  const { data: piiPolicy, isLoading: piiLoading } = useGovernancePolicy(
    organizationId,
    'pii_config',
  );
  const { data: chatFilterPolicy, isLoading: chatFilterLoading } =
    useGovernancePolicy(organizationId, 'chat_filter');
  const { data: moderationPolicy, isLoading: moderationLoading } =
    useGovernancePolicy(organizationId, 'moderation_provider');

  const chatFilterEnabled = !!chatFilterPolicy?.enabled;
  const chatFilterParsed = chatFilterPolicy
    ? chatFilterConfigSchema.safeParse(chatFilterPolicy.config)
    : null;
  const chatFilterConfig = chatFilterParsed?.success
    ? chatFilterParsed.data
    : undefined;

  // Resolve event `categoryIds` (immutable slugs) to current admin-edited
  // labels for display. Falls back to the raw id if a category was renamed
  // / deleted since the event fired. Must stay above any early return to
  // keep hook order stable across loading transitions.
  const chatFilterLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of chatFilterConfig?.categories ?? []) {
      map.set(c.id, c.label);
    }
    return map;
  }, [chatFilterConfig]);

  if (piiLoading || chatFilterLoading || moderationLoading) {
    return (
      <PageSection
        title={t('guardrailsOverview.title')}
        description={t('guardrailsOverview.description')}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-border rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <Skeleton className="size-4 rounded-sm" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="ml-auto size-4 rounded-full" />
              </div>
              <Skeleton className="mb-3 h-3 w-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>

        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-9 w-32 rounded-md" />
            </div>
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
        </section>
      </PageSection>
    );
  }
  const chatFilterDetails: string[] = chatFilterEnabled
    ? [
        t('guardrailsOverview.statusCards.contentSafety.appliesTo', {
          targets: (chatFilterConfig?.appliesTo ?? ['input']).join(', '),
        }),
        t('guardrailsOverview.statusCards.contentSafety.categories', {
          count: chatFilterConfig?.categories?.length ?? 0,
        }),
        t('guardrailsOverview.statusCards.contentSafety.maskReplacement', {
          value: chatFilterConfig?.maskReplacement ?? '[BLOCKED]',
        }),
      ]
    : [];

  const piiEnabled = !!piiPolicy?.enabled;
  const piiParsed = piiPolicy
    ? piiConfigSchema.safeParse(piiPolicy.config)
    : null;
  const piiConfig = piiParsed?.success ? piiParsed.data : undefined;
  const piiDetails: string[] = piiEnabled
    ? [
        t('guardrailsOverview.statusCards.pii.mode', {
          mode: piiConfig?.mode ?? 'mask',
        }),
        t('guardrailsOverview.statusCards.pii.patterns', {
          builtIn: piiConfig?.enabledPatterns?.length ?? 0,
          custom: piiConfig?.customPatterns?.length ?? 0,
        }),
      ]
    : [];

  const moderationEnabled = !!moderationPolicy?.enabled;
  const moderationParsed = moderationPolicy
    ? moderationProviderConfigSchema.safeParse(moderationPolicy.config)
    : null;
  const moderationConfig = moderationParsed?.success
    ? moderationParsed.data
    : undefined;
  const moderationDetails: string[] = moderationEnabled
    ? [
        t('guardrailsOverview.statusCards.moderation.provider', {
          value: moderationConfig?.responseShape?.type ?? 'custom_jsonpath',
        }),
        t('guardrailsOverview.statusCards.moderation.appliesTo', {
          targets: (moderationConfig?.appliesTo ?? ['input']).join(', '),
        }),
        t('guardrailsOverview.statusCards.moderation.mappings', {
          count: moderationConfig?.categoryMappings?.length ?? 0,
        }),
        t('guardrailsOverview.statusCards.moderation.failBehavior', {
          input: moderationConfig?.failBehavior?.input ?? 'open',
          output: moderationConfig?.failBehavior?.output ?? 'closed',
        }),
      ]
    : [];

  return (
    <PageSection
      title={t('guardrailsOverview.title')}
      description={t('guardrailsOverview.description')}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          title={t('guardrailsOverview.statusCards.contentSafety.title')}
          description={t(
            'guardrailsOverview.statusCards.contentSafety.description',
          )}
          enabled={chatFilterEnabled}
          details={chatFilterDetails}
          disabledReason={t(
            'guardrailsOverview.statusCards.contentSafety.disabled',
          )}
          icon={ShieldAlert}
        />
        <StatusCard
          title={t('guardrailsOverview.statusCards.pii.title')}
          description={t('guardrailsOverview.statusCards.pii.description')}
          enabled={piiEnabled}
          details={piiDetails}
          disabledReason={t('guardrailsOverview.statusCards.pii.disabled')}
          icon={ShieldAlert}
        />
        <StatusCard
          title={t('guardrailsOverview.statusCards.moderation.title')}
          description={t(
            'guardrailsOverview.statusCards.moderation.description',
          )}
          enabled={moderationEnabled}
          details={moderationDetails}
          disabledReason={t(
            'guardrailsOverview.statusCards.moderation.disabled',
          )}
          icon={ShieldAlert}
        />
      </div>

      <RecentEvents
        organizationId={organizationId}
        chatFilterLabels={chatFilterLabels}
      />
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// Recent events table
// ---------------------------------------------------------------------------

type FilterNameFilter = 'all' | 'pii' | 'chat_filter' | 'moderation_provider';
type KindFilter =
  | 'all'
  | 'detected'
  | 'blocked'
  | 'step_error'
  | 'circuit_open';

interface RecentEventsProps {
  organizationId: string;
  chatFilterLabels: Map<string, string>;
}

function RecentEvents({ organizationId, chatFilterLabels }: RecentEventsProps) {
  const { t } = useT('governance');
  const [filterName, setFilterName] = useState<FilterNameFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [selectedEvent, setSelectedEvent] = useState<RecentEvent | null>(null);
  const { formatDate } = useFormatDate();

  const queryArgs = useMemo(
    () => ({
      organizationId,
      limit: 50,
      ...(filterName !== 'all' ? { filterName } : {}),
      ...(kind !== 'all' ? { kind } : {}),
    }),
    [organizationId, filterName, kind],
  );

  const { data: events, isLoading } = useConvexQuery(
    api.chat_filter_events.queries.listRecent,
    queryArgs,
  );

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t('guardrailsOverview.recentEvents.title')}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t('guardrailsOverview.recentEvents.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={filterName}
            onValueChange={(v) => {
              if (
                v === 'all' ||
                v === 'pii' ||
                v === 'chat_filter' ||
                v === 'moderation_provider'
              ) {
                setFilterName(v);
              }
            }}
            options={[
              {
                value: 'all',
                label: t('guardrailsOverview.recentEvents.filterAll'),
              },
              {
                value: 'pii',
                label: t('guardrailsOverview.recentEvents.filterPii'),
              },
              {
                value: 'chat_filter',
                label: t('guardrailsOverview.recentEvents.filterChatFilter'),
              },
              {
                value: 'moderation_provider',
                label: t('guardrailsOverview.recentEvents.filterModeration'),
              },
            ]}
          />
          <Select
            value={kind}
            onValueChange={(v) => {
              if (
                v === 'all' ||
                v === 'detected' ||
                v === 'blocked' ||
                v === 'step_error' ||
                v === 'circuit_open'
              ) {
                setKind(v);
              }
            }}
            options={[
              {
                value: 'all',
                label: t('guardrailsOverview.recentEvents.kindAll'),
              },
              {
                value: 'detected',
                label: t('guardrailsOverview.recentEvents.kindDetected'),
              },
              {
                value: 'blocked',
                label: t('guardrailsOverview.recentEvents.kindBlocked'),
              },
              {
                value: 'step_error',
                label: t('guardrailsOverview.recentEvents.kindStepError'),
              },
              {
                value: 'circuit_open',
                label: t('guardrailsOverview.recentEvents.kindCircuitOpen'),
              },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !events || events.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border p-6 text-center text-sm">
          {t('guardrailsOverview.recentEvents.empty')}
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/40 text-muted-foreground border-b text-left text-xs">
                <th className="px-3 py-2 font-medium">
                  {t('guardrailsOverview.recentEvents.columnTime')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t('guardrailsOverview.recentEvents.columnFilter')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t('guardrailsOverview.recentEvents.columnDirection')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t('guardrailsOverview.recentEvents.columnKind')}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t('guardrailsOverview.recentEvents.columnCategories')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('guardrailsOverview.recentEvents.columnMatches')}
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const typedEvent = event as RecentEvent;
                return (
                  <tr
                    key={typedEvent._id}
                    className="border-border hover:bg-muted/30 cursor-pointer border-t transition-colors"
                    tabIndex={0}
                    aria-label={t(
                      'guardrailsOverview.recentEvents.viewEventAria',
                      { id: typedEvent._id },
                    )}
                    onClick={() => setSelectedEvent(typedEvent)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedEvent(typedEvent);
                      }
                    }}
                  >
                    <td
                      className="px-3 py-2 whitespace-nowrap"
                      title={formatDate(
                        new Date(typedEvent.createdAt),
                        'medium',
                      )}
                    >
                      {formatDate(new Date(typedEvent.createdAt), 'relative')}
                    </td>
                    <td className="px-3 py-2">
                      {filterNameLabel(typedEvent.filterName, t)}
                    </td>
                    <td className="px-3 py-2 capitalize">
                      {typedEvent.direction}
                    </td>
                    <td className="px-3 py-2">
                      <KindBadge kind={typedEvent.kind} />
                    </td>
                    <td className="px-3 py-2">
                      {typedEvent.categoryIds.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-xs">
                          {resolveCategoryLabels(
                            typedEvent.filterName,
                            typedEvent.categoryIds,
                            chatFilterLabels,
                          ).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {typedEvent.matchCount ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EventDetailSheet
        event={selectedEvent}
        chatFilterLabels={chatFilterLabels}
        onClose={() => setSelectedEvent(null)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Event detail sheet
// ---------------------------------------------------------------------------

interface EventDetailSheetProps {
  event: RecentEvent | null;
  chatFilterLabels: Map<string, string>;
  onClose: () => void;
}

function EventDetailSheet({
  event,
  chatFilterLabels,
  onClose,
}: EventDetailSheetProps) {
  const { t } = useT('governance');
  const { formatDate } = useFormatDate();
  const { toast } = useToast();
  const open = event !== null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t('guardrailsOverview.eventDetails.copied', { label }),
        variant: 'success',
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('guardrailsOverview.eventDetails.copyFailed');
      toast({ title: message, variant: 'destructive' });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('guardrailsOverview.eventDetails.title')}
      description={t('guardrailsOverview.eventDetails.description')}
      className="sm:!max-w-xl"
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 pr-10">
          <h2 className="text-lg font-semibold tracking-tight">
            {t('guardrailsOverview.eventDetails.title')}
          </h2>
          {event && (
            <p className="text-muted-foreground mt-1 text-sm">
              {formatDate(new Date(event.createdAt), 'medium')}
            </p>
          )}
        </div>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {event && (
            <dl className="space-y-4 text-sm">
              <DetailRow label={t('guardrailsOverview.eventDetails.filter')}>
                {filterNameLabel(event.filterName, t)}
              </DetailRow>
              <DetailRow label={t('guardrailsOverview.eventDetails.direction')}>
                <span className="capitalize">{event.direction}</span>
              </DetailRow>
              <DetailRow label={t('guardrailsOverview.eventDetails.kind')}>
                <KindBadge kind={event.kind} />
              </DetailRow>
              <DetailRow
                label={t('guardrailsOverview.eventDetails.categories')}
              >
                {event.categoryIds.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {event.categoryIds.map((id) => {
                      const label =
                        event.filterName === 'chat_filter'
                          ? chatFilterLabels.get(id)
                          : undefined;
                      return (
                        <li
                          key={id}
                          className="bg-muted/60 inline-flex items-center gap-2 rounded px-2 py-1 text-xs"
                        >
                          <span className="font-medium">{label ?? id}</span>
                          {label && (
                            <span className="text-muted-foreground font-mono text-[10px]">
                              {id}
                            </span>
                          )}
                          {event.filterName === 'chat_filter' && !label && (
                            <span className="text-muted-foreground italic">
                              {t(
                                'guardrailsOverview.eventDetails.categoryDeleted',
                              )}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DetailRow>
              <DetailRow label={t('guardrailsOverview.eventDetails.matches')}>
                <span className="tabular-nums">{event.matchCount ?? 0}</span>
              </DetailRow>
              {event.truncated && (
                <DetailRow
                  label={t('guardrailsOverview.eventDetails.truncated')}
                >
                  <span className="text-amber-600">
                    {t('guardrailsOverview.eventDetails.truncatedValue')}
                  </span>
                </DetailRow>
              )}
              {event.errorClass && (
                <DetailRow
                  label={t('guardrailsOverview.eventDetails.errorClass')}
                >
                  <span className="font-mono text-xs">{event.errorClass}</span>
                </DetailRow>
              )}
              {event.httpStatus !== undefined && (
                <DetailRow
                  label={t('guardrailsOverview.eventDetails.httpStatus')}
                >
                  <span className="tabular-nums">{event.httpStatus}</span>
                </DetailRow>
              )}
              {event.durationMs !== undefined && (
                <DetailRow
                  label={t('guardrailsOverview.eventDetails.duration')}
                >
                  <span className="tabular-nums">
                    {t('guardrailsOverview.eventDetails.durationValue', {
                      ms: event.durationMs,
                    })}
                  </span>
                </DetailRow>
              )}
              {event.attempt !== undefined && (
                <DetailRow label={t('guardrailsOverview.eventDetails.attempt')}>
                  <span className="tabular-nums">{event.attempt}</span>
                </DetailRow>
              )}
              <DetailRow
                label={t('guardrailsOverview.eventDetails.sanitizationRun')}
              >
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                  onClick={() =>
                    void copy(
                      event.sanitizationRunId,
                      t(
                        'guardrailsOverview.eventDetails.sanitizationRunCopyLabel',
                      ),
                    )
                  }
                >
                  {event.sanitizationRunId}
                  <Copy className="size-3" aria-hidden />
                </button>
              </DetailRow>
              <DetailRow label={t('guardrailsOverview.eventDetails.thread')}>
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                  onClick={() =>
                    void copy(
                      event.threadId,
                      t('guardrailsOverview.eventDetails.threadCopyLabel'),
                    )
                  }
                >
                  {event.threadId}
                  <Copy className="size-3" aria-hidden />
                </button>
              </DetailRow>
              {event.messageId && (
                <DetailRow label={t('guardrailsOverview.eventDetails.message')}>
                  <button
                    type="button"
                    className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                    onClick={() =>
                      void copy(
                        event.messageId ?? '',
                        t('guardrailsOverview.eventDetails.messageCopyLabel'),
                      )
                    }
                  >
                    {event.messageId}
                    <Copy className="size-3" aria-hidden />
                  </button>
                </DetailRow>
              )}
              {event.agentSlug && (
                <DetailRow label={t('guardrailsOverview.eventDetails.agent')}>
                  {event.agentSlug}
                </DetailRow>
              )}
              {event.actorType && (
                <DetailRow
                  label={t('guardrailsOverview.eventDetails.actorType')}
                >
                  <span className="capitalize">{event.actorType}</span>
                </DetailRow>
              )}
              <DetailRow label={t('guardrailsOverview.eventDetails.timestamp')}>
                {formatDate(new Date(event.createdAt), 'medium')}
              </DetailRow>
            </dl>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>
            {t('guardrailsOverview.eventDetails.close')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function filterNameLabel(name: string, t: (key: string) => string): string {
  if (name === 'pii') return t('guardrailsOverview.filterNames.pii');
  if (name === 'chat_filter')
    return t('guardrailsOverview.filterNames.chatFilter');
  if (name === 'moderation_provider')
    return t('guardrailsOverview.filterNames.moderation');
  return name;
}

/**
 * Resolve category IDs to display labels. `chat_filter` stores immutable
 * slugs like `custom_mgskmh` that need to be looked up against the current
 * admin-edited labels. `pii` stores pattern names (`email`, `phone`) that
 * are already human-readable. `moderation_provider` stores `internalLabel`
 * from the category mapping config, also already human-readable.
 */
function resolveCategoryLabels(
  filterName: string,
  ids: readonly string[],
  chatFilterLabels: Map<string, string>,
): string[] {
  if (filterName !== 'chat_filter') return [...ids];
  return ids.map((id) => chatFilterLabels.get(id) ?? id);
}

function KindBadge({ kind }: { kind: string }) {
  const { t } = useT('governance');
  const classes =
    kind === 'blocked'
      ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
      : kind === 'detected'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
        : kind === 'step_error'
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
          : 'bg-muted text-muted-foreground';
  const label =
    kind === 'blocked'
      ? t('guardrailsOverview.recentEvents.kindBlocked')
      : kind === 'detected'
        ? t('guardrailsOverview.recentEvents.kindDetected')
        : kind === 'step_error'
          ? t('guardrailsOverview.recentEvents.kindStepError')
          : kind === 'circuit_open'
            ? t('guardrailsOverview.recentEvents.kindCircuitOpen')
            : kind.replace('_', ' ');
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
