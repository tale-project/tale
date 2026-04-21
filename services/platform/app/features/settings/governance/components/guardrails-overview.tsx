'use client';

import { CheckCircle2, Circle, Copy, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Select } from '@/app/components/ui/forms/select';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
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
  icon: LucideIcon;
}

function StatusCard({
  title,
  description,
  enabled,
  details,
  icon: Icon,
}: StatusCardProps) {
  const Indicator = enabled ? CheckCircle2 : Circle;
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
        <Indicator
          className={
            enabled
              ? 'ml-auto size-4 text-emerald-600'
              : 'text-muted-foreground ml-auto size-4'
          }
          aria-hidden
        />
      </div>
      <div className="text-muted-foreground mb-3 text-xs">{description}</div>
      <ul className="text-xs">
        {details.map((detail) => (
          <li key={detail} className="py-0.5">
            {detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GuardrailsOverview({
  organizationId,
}: GuardrailsOverviewProps) {
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
      <PageSection title="Guardrails overview">
        <Skeleton className="h-48 w-full" />
      </PageSection>
    );
  }
  const chatFilterDetails: string[] = chatFilterEnabled
    ? [
        `Applies to: ${(chatFilterConfig?.appliesTo ?? ['input']).join(', ')}`,
        `Categories: ${chatFilterConfig?.categories?.length ?? 0}`,
        `Mask replacement: ${chatFilterConfig?.maskReplacement ?? '[BLOCKED]'}`,
      ]
    : ['Disabled — add a category and enable to start filtering.'];

  const piiEnabled = !!piiPolicy?.enabled;
  const piiParsed = piiPolicy
    ? piiConfigSchema.safeParse(piiPolicy.config)
    : null;
  const piiConfig = piiParsed?.success ? piiParsed.data : undefined;
  const piiDetails: string[] = piiEnabled
    ? [
        `Mode: ${piiConfig?.mode ?? 'mask'}`,
        `Patterns: ${piiConfig?.enabledPatterns?.length ?? 0} built-in + ${
          piiConfig?.customPatterns?.length ?? 0
        } custom`,
      ]
    : ['Disabled — PII detection is off for this organization.'];

  const moderationEnabled = !!moderationPolicy?.enabled;
  const moderationParsed = moderationPolicy
    ? moderationProviderConfigSchema.safeParse(moderationPolicy.config)
    : null;
  const moderationConfig = moderationParsed?.success
    ? moderationParsed.data
    : undefined;
  const moderationDetails: string[] = moderationEnabled
    ? [
        `Provider: ${moderationConfig?.responseShape?.type ?? 'custom_jsonpath'}`,
        `Applies to: ${(moderationConfig?.appliesTo ?? ['input']).join(', ')}`,
        `Mappings: ${moderationConfig?.categoryMappings?.length ?? 0}`,
        `Fail behavior: in=${moderationConfig?.failBehavior?.input ?? 'open'}, out=${moderationConfig?.failBehavior?.output ?? 'closed'}`,
      ]
    : ['Disabled — no external moderation API configured.'];

  return (
    <PageSection
      title="Guardrails overview"
      description="Read-only snapshot of the three filter layers. Each one runs in order per message: chat_filter → PII → moderation_provider."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          title="Content safety"
          description="Word lists and admin-supplied regex patterns."
          enabled={chatFilterEnabled}
          details={chatFilterDetails}
          icon={ShieldAlert}
        />
        <StatusCard
          title="PII detection"
          description="Built-in patterns for emails, phones, IDs, etc."
          enabled={piiEnabled}
          details={piiDetails}
          icon={ShieldAlert}
        />
        <StatusCard
          title="Moderation provider"
          description="External classifier (OpenAI / Azure / Perspective / custom)."
          enabled={moderationEnabled}
          details={moderationDetails}
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
          <h3 className="text-sm font-semibold">Recent events</h3>
          <p className="text-muted-foreground text-xs">
            Last 50 detections / blocks / provider errors for this org. Raw
            matched text is never stored.
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
              { value: 'all', label: 'All filters' },
              { value: 'pii', label: 'PII' },
              { value: 'chat_filter', label: 'Content safety' },
              { value: 'moderation_provider', label: 'Moderation' },
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
              { value: 'all', label: 'All kinds' },
              { value: 'detected', label: 'Detected' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'step_error', label: 'Step error' },
              { value: 'circuit_open', label: 'Circuit open' },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !events || events.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border p-6 text-center text-sm">
          No events yet. Detections from flag / mask / block modes will appear
          here once chat traffic starts flowing.
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-muted/40 text-muted-foreground border-b text-left text-xs">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Filter</th>
                <th className="px-3 py-2 font-medium">Direction</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Categories</th>
                <th className="px-3 py-2 text-right font-medium">Matches</th>
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
                    aria-label={`View event ${typedEvent._id}`}
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
                      {filterNameLabel(typedEvent.filterName)}
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
  const { formatDate } = useFormatDate();
  const { toast } = useToast();
  const open = event !== null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied`, variant: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Copy failed';
      toast({ title: message, variant: 'destructive' });
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Event details"
      description="Full metadata for a guardrails event. Raw matched text is never stored."
      className="sm:!max-w-xl"
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 pr-10">
          <h2 className="text-lg font-semibold tracking-tight">
            Event details
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
              <DetailRow label="Filter">
                {filterNameLabel(event.filterName)}
              </DetailRow>
              <DetailRow label="Direction">
                <span className="capitalize">{event.direction}</span>
              </DetailRow>
              <DetailRow label="Kind">
                <KindBadge kind={event.kind} />
              </DetailRow>
              <DetailRow label="Categories">
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
                              (deleted)
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DetailRow>
              <DetailRow label="Matches">
                <span className="tabular-nums">{event.matchCount ?? 0}</span>
              </DetailRow>
              {event.truncated && (
                <DetailRow label="Truncated">
                  <span className="text-amber-600">
                    Yes — message exceeded the scan-length cap
                  </span>
                </DetailRow>
              )}
              {event.errorClass && (
                <DetailRow label="Error class">
                  <span className="font-mono text-xs">{event.errorClass}</span>
                </DetailRow>
              )}
              {event.httpStatus !== undefined && (
                <DetailRow label="HTTP status">
                  <span className="tabular-nums">{event.httpStatus}</span>
                </DetailRow>
              )}
              {event.durationMs !== undefined && (
                <DetailRow label="Duration">
                  <span className="tabular-nums">{event.durationMs} ms</span>
                </DetailRow>
              )}
              {event.attempt !== undefined && (
                <DetailRow label="Attempt">
                  <span className="tabular-nums">{event.attempt}</span>
                </DetailRow>
              )}
              <DetailRow label="Sanitization run">
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                  onClick={() =>
                    void copy(event.sanitizationRunId, 'Sanitization run id')
                  }
                >
                  {event.sanitizationRunId}
                  <Copy className="size-3" aria-hidden />
                </button>
              </DetailRow>
              <DetailRow label="Thread">
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                  onClick={() => void copy(event.threadId, 'Thread id')}
                >
                  {event.threadId}
                  <Copy className="size-3" aria-hidden />
                </button>
              </DetailRow>
              {event.messageId && (
                <DetailRow label="Message">
                  <button
                    type="button"
                    className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 font-mono text-xs"
                    onClick={() =>
                      void copy(event.messageId ?? '', 'Message id')
                    }
                  >
                    {event.messageId}
                    <Copy className="size-3" aria-hidden />
                  </button>
                </DetailRow>
              )}
              {event.agentSlug && (
                <DetailRow label="Agent">{event.agentSlug}</DetailRow>
              )}
              {event.actorType && (
                <DetailRow label="Actor type">
                  <span className="capitalize">{event.actorType}</span>
                </DetailRow>
              )}
              <DetailRow label="Timestamp">
                {formatDate(new Date(event.createdAt), 'medium')}
              </DetailRow>
            </dl>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={onClose}>
            Close
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

function filterNameLabel(name: string): string {
  if (name === 'pii') return 'PII';
  if (name === 'chat_filter') return 'Content safety';
  if (name === 'moderation_provider') return 'Moderation';
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
  const classes =
    kind === 'blocked'
      ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
      : kind === 'detected'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
        : kind === 'step_error'
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
          : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${classes}`}
    >
      {kind.replace('_', ' ')}
    </span>
  );
}
