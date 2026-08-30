'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Grid, Row, Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Copy, Fingerprint, ListFilter, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
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

type OffKind = 'off' | 'not_configured';

interface StatusCardProps {
  title: string;
  description: string;
  enabled: boolean;
  /** One short summary when on. Omitted when off — sections below explain why. */
  summary?: string;
  offKind: OffKind;
  href: string;
  icon: LucideIcon;
}

/** Lean status card: title, blurb, state, optional on-summary. Whole card jumps. */
function StatusCard({
  title,
  description,
  enabled,
  summary,
  offKind,
  href,
  icon: Icon,
}: StatusCardProps) {
  const { t } = useT('governance');
  const loading = useSkeleton();
  const statusLabel = enabled
    ? t('guardrailsOverview.statusCards.on')
    : offKind === 'not_configured'
      ? t('guardrailsOverview.statusCards.notConfigured')
      : t('guardrailsOverview.statusCards.off');

  return (
    <Card padding="md" asChild interactive>
      <a href={href}>
        <Row gap={2} className="mb-1">
          <Icon
            className={
              enabled && !loading
                ? 'text-success size-4'
                : 'text-muted-foreground size-4'
            }
            aria-hidden
          />
          <div className="font-medium">{title}</div>
        </Row>
        <p className="text-muted-foreground mb-3 text-xs">{description}</p>
        <Badge variant={enabled && !loading ? 'green' : 'slate'}>
          {statusLabel}
        </Badge>
        {enabled && summary && !loading ? (
          <p className="text-muted-foreground mt-2 text-xs">{summary}</p>
        ) : null}
      </a>
    </Card>
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

  const isLoading = piiLoading || chatFilterLoading || moderationLoading;

  const chatFilterSummary = chatFilterEnabled
    ? t('guardrailsOverview.statusCards.contentSafety.summary', {
        count: chatFilterConfig?.categories?.length ?? 0,
        targets: (chatFilterConfig?.appliesTo ?? ['input']).join(', '),
      })
    : undefined;

  const piiEnabled = !!piiPolicy?.enabled;
  const piiParsed = piiPolicy
    ? piiConfigSchema.safeParse(piiPolicy.config)
    : null;
  const piiConfig = piiParsed?.success ? piiParsed.data : undefined;
  const piiSummary = piiEnabled
    ? t('guardrailsOverview.statusCards.pii.summary', {
        mode: piiConfig?.mode ?? 'mask',
      })
    : undefined;

  const moderationEnabled = !!moderationPolicy?.enabled;
  const moderationParsed = moderationPolicy
    ? moderationProviderConfigSchema.safeParse(moderationPolicy.config)
    : null;
  const moderationConfig = moderationParsed?.success
    ? moderationParsed.data
    : undefined;
  const moderationSummary = moderationEnabled
    ? t('guardrailsOverview.statusCards.moderation.summary', {
        value: moderationConfig?.responseShape?.type ?? 'custom_jsonpath',
      })
    : undefined;

  return (
    <Skeletonize loading={isLoading} label={t('guardrailsOverview.title')}>
      <SettingsSection
        title={t('guardrailsOverview.title')}
        description={t('guardrailsOverview.description')}
      >
        {/* Marked so the shared divider rule separates the two sub-blocks
            of this section (cards, then the events table) with the same
            hairline every settings surface uses. */}
        <Grid md={3} data-settings-section="">
          <StatusCard
            title={t('guardrailsOverview.statusCards.contentSafety.title')}
            description={t(
              'guardrailsOverview.statusCards.contentSafety.description',
            )}
            enabled={chatFilterEnabled}
            summary={chatFilterSummary}
            offKind={
              (chatFilterConfig?.categories?.length ?? 0) === 0
                ? 'not_configured'
                : 'off'
            }
            href="#guardrails-content-safety"
            icon={ListFilter}
          />
          <StatusCard
            title={t('guardrailsOverview.statusCards.pii.title')}
            description={t('guardrailsOverview.statusCards.pii.description')}
            enabled={piiEnabled}
            summary={piiSummary}
            offKind="off"
            href="#guardrails-pii"
            icon={Fingerprint}
          />
          <StatusCard
            title={t('guardrailsOverview.statusCards.moderation.title')}
            description={t(
              'guardrailsOverview.statusCards.moderation.description',
            )}
            enabled={moderationEnabled}
            summary={moderationSummary}
            offKind={moderationConfig?.endpoint?.url ? 'off' : 'not_configured'}
            href="#guardrails-moderation"
            icon={Shield}
          />
        </Grid>

        <RecentEvents
          organizationId={organizationId}
          chatFilterLabels={chatFilterLabels}
        />
      </SettingsSection>
    </Skeletonize>
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

  const { data: events, isLoading } = useBackendQuery(
    'chat_filter_events/queries:listRecent',
    queryArgs,
  );

  return (
    <Stack as="section" data-settings-section="">
      <Row gap={3} align="start" justify="between" wrap>
        <SectionHeader
          as="h2"
          className="min-w-0"
          title={t('guardrailsOverview.recentEvents.title')}
          description={t('guardrailsOverview.recentEvents.description')}
        />
        {/* One filter button for the list, matching the sibling log views —
            both dimensions live in it as sections. */}
        <DataTableFilters
          filters={[
            {
              key: 'source',
              title: t('guardrailsOverview.recentEvents.columnFilter'),
              options: [
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
              ],
              selectedValues: filterName === 'all' ? [] : [filterName],
              onChange: (values) => {
                const v = values[0];
                setFilterName(
                  v === 'pii' ||
                    v === 'chat_filter' ||
                    v === 'moderation_provider'
                    ? v
                    : 'all',
                );
              },
            },
            {
              key: 'kind',
              title: t('guardrailsOverview.recentEvents.columnKind'),
              options: [
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
              ],
              selectedValues: kind === 'all' ? [] : [kind],
              onChange: (values) => {
                const v = values[0];
                setKind(
                  v === 'detected' ||
                    v === 'blocked' ||
                    v === 'step_error' ||
                    v === 'circuit_open'
                    ? v
                    : 'all',
                );
              },
            },
          ]}
        />
      </Row>

      {!isLoading && (!events || events.length === 0) ? (
        // Same bordered shell as the table below so empty/loaded don't jump
        // chrome. EmptyState itself is borderless by design.
        <div className="border-border overflow-hidden rounded-lg border">
          <EmptyState
            icon={Shield}
            title={t('guardrailsOverview.recentEvents.empty.title')}
            description={t('guardrailsOverview.recentEvents.empty.description')}
          />
        </div>
      ) : (
        // While loading, render the SAME table shell with placeholder rows
        // (wrapped in `<Skeletonize>` so the masked cells announce "Loading"
        // once) instead of an empty grid or a single magic-height block.
        <Skeletonize
          loading={isLoading}
          label={t('guardrailsOverview.recentEvents.title')}
          className="border-border overflow-hidden rounded-lg border"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('guardrailsOverview.recentEvents.columnTime')}
                </TableHead>
                <TableHead>
                  {t('guardrailsOverview.recentEvents.columnFilter')}
                </TableHead>
                <TableHead>
                  {t('guardrailsOverview.recentEvents.columnDirection')}
                </TableHead>
                <TableHead>
                  {t('guardrailsOverview.recentEvents.columnKind')}
                </TableHead>
                <TableHead>
                  {t('guardrailsOverview.recentEvents.columnCategories')}
                </TableHead>
                <TableHead className="text-right">
                  {t('guardrailsOverview.recentEvents.columnMatches')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <div
                            className="max-w-24"
                            style={{
                              width: `${58 + ((i * 17 + j * 29) % 35)}%`,
                            }}
                          >
                            <SkeletonBox fullWidth>
                              <div className="h-3.5" />
                            </SkeletonBox>
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : (events ?? []).map((event) => {
                    const typedEvent = event as RecentEvent;
                    return (
                      <TableRow
                        key={typedEvent._id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
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
                        <TableCell
                          className="whitespace-nowrap"
                          title={formatDate(
                            new Date(typedEvent.createdAt),
                            'medium',
                          )}
                        >
                          {formatDate(
                            new Date(typedEvent.createdAt),
                            'relative',
                          )}
                        </TableCell>
                        <TableCell>
                          {filterNameLabel(typedEvent.filterName, t)}
                        </TableCell>
                        <TableCell className="capitalize">
                          {typedEvent.direction}
                        </TableCell>
                        <TableCell>
                          <KindBadge kind={typedEvent.kind} />
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {typedEvent.matchCount ?? 0}
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </Skeletonize>
      )}

      <EventDetailSheet
        event={selectedEvent}
        chatFilterLabels={chatFilterLabels}
        onClose={() => setSelectedEvent(null)}
      />
    </Stack>
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
      // Browser clipboard permission/security errors are dev-facing (e.g.
      // `NotAllowedError: Write permission denied.`) — log for debugging, but
      // never surface the raw message in the toast (#2669 sibling: the same
      // "raw thrown-error text reaches the user" defect class as the
      // BackendError save-error toasts this file's siblings route through
      // `mapGovernanceSaveError`).
      console.warn('[guardrails] clipboard write failed', err);
      toast({
        title: t('guardrailsOverview.eventDetails.copyFailed'),
        variant: 'destructive',
      });
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
      <Stack gap={0} className="h-full">
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
                  <Stack as="ul" gap={1}>
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
                  </Stack>
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

        <Row
          gap={2}
          align="stretch"
          justify="end"
          className="shrink-0 border-t pt-4"
        >
          <Button variant="ghost" onClick={onClose}>
            {t('guardrailsOverview.eventDetails.close')}
          </Button>
        </Row>
      </Stack>
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
  // Same themed chip convention as the DSAR status badges (H10-1/2): /20
  // tinted bg clears WCAG 1.4.11 non-text contrast, text pairs for dark.
  // (The shared Badge's colored variants carry no dark classes, so they
  // can't be used for themed status chips yet.)
  const classes =
    kind === 'blocked'
      ? 'bg-red-500/20 text-red-700 dark:text-red-300'
      : kind === 'detected'
        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
        : kind === 'step_error'
          ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300'
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
