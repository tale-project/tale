'use client';

/**
 * The per-message info panel: which model answered and where it was served,
 * how fast the reply came, what it cost in tokens and dollars, and what the
 * turn's tools were asked and answered.
 *
 * Everything renders from the message row itself — `usage` is the blob the
 * turn pipeline stamped, read defensively because a turn records only what
 * its lane could measure. Fields a turn did not record are hidden rather
 * than zero-filled, so the panel never invents a number. Where the reply was
 * served follows the same rule: the upstream, region and model version are
 * what the provider's responses said, and a region set by a documented
 * regional endpoint says so; a reply nobody located reads "Not reported"
 * instead of a guess from a provider's name. The one live read is the
 * voice-output breakdown, through the chat seam (`useChatQuery`), fetched
 * only while the dialog is open.
 *
 * The shell is the base `Dialog`, not `ViewDialog`: the toolbar mounts this
 * on surfaces (and in tests) with no router in scope, and `ViewDialog`'s
 * error boundary reads the org id from route params.
 */

import { cn } from '@tale/ui/cn';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useCopyButton } from '@tale/ui/use-copy';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useId } from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { messageVoiceUsageQuery } from '@/app/lib/backend/chat';
import type { EndpointRegion } from '@/lib/chat/types';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';
import { formatRelativeTime } from '@/lib/utils/format/relative-time';
import { isRecord } from '@/lib/utils/type-utils';

import {
  useChatQueryClient,
  useComposerModelNames,
} from '../data/chat-backend';
import type { ChatMessageUsage, ChatMessageView, MessagePart } from '../types';
import {
  outputTokensPerSecond,
  replyPhases,
  type ReplyPhaseKind,
} from '../utils/message-timing';

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A duration for humans, in the reader's number format: sub-second stays in
 * ms, everything else in s. */
function formatMs(ms: number, locale: string): string {
  if (ms < 1000) return `${formatNumber(Math.round(ms), locale)} ms`;
  const digits = ms < 10_000 ? 2 : 1;
  return `${formatNumber(ms / 1000, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} s`;
}

/** JSON for the tool previews that never throws — a preview must not be able
 * to take the dialog down over an odd payload. */
function jsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch (error) {
    console.warn(
      '[chat] tool payload could not be serialized for preview',
      error,
    );
    return String(value);
  }
}

/** The strings of a list in the free-form usage blob — the client never
 * validated it, so anything that is not a non-empty string is dropped. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
}

const ENDPOINT_REGIONS: readonly EndpointRegion[] = ['europe', 'united-states'];

/** Where the turn was served, read defensively off the usage blob. */
function readServing(usage: ChatMessageUsage): {
  providers: string[];
  regions: string[];
  models: string[];
  endpoint?: { host: string; region: EndpointRegion };
} {
  const raw: unknown = usage.serving;
  if (!isRecord(raw)) return { providers: [], regions: [], models: [] };
  const endpoint = isRecord(raw.endpoint) ? raw.endpoint : undefined;
  const host = typeof endpoint?.host === 'string' ? endpoint.host : undefined;
  const region = ENDPOINT_REGIONS.find((value) => value === endpoint?.region);
  return {
    providers: stringList(raw.providers),
    regions: stringList(raw.regions),
    models: stringList(raw.models),
    ...(host !== undefined && region !== undefined
      ? { endpoint: { host, region } }
      : {}),
  };
}

/** A region as a provider stated it. The codes a provider echoes
 * (Anthropic's `inference_geo`) read as words; a name (Azure's
 * `Sweden Central`) reads as itself. */
function regionLabel(region: string, t: Translate): string {
  switch (region.toLowerCase()) {
    case 'global':
      return t('messageInfo.regionGlobal');
    case 'us':
      return t('messageInfo.regions.unitedStates');
    case 'eu':
    case 'europe':
      return t('messageInfo.regions.europe');
    default:
      return region;
  }
}

function endpointRegionLabel(region: EndpointRegion, t: Translate): string {
  return region === 'europe'
    ? t('messageInfo.regions.europe')
    : t('messageInfo.regions.unitedStates');
}

/** One tool call of the turn, paired with its result. */
interface ToolCallView {
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
  readonly output?: unknown;
}

/** Pair each tool-call part with its result by call id — the same fold the
 * thought timeline does — keeping the authored order. */
function pairToolCalls(parts: readonly MessagePart[]): ToolCallView[] {
  const resultsByCall = new Map<string, unknown>();
  for (const part of parts) {
    if (part.type === 'tool-result') {
      resultsByCall.set(part.callId, part.output);
    }
  }
  const calls: ToolCallView[] = [];
  for (const part of parts) {
    if (part.type !== 'tool-call') continue;
    calls.push({
      callId: part.callId,
      name: part.capabilityId,
      input: part.input,
      ...(resultsByCall.has(part.callId)
        ? { output: resultsByCall.get(part.callId) }
        : {}),
    });
  }
  return calls;
}

function ToolCallCard({ call, t }: { call: ToolCallView; t: Translate }) {
  const input = jsonPreview(call.input);
  const output = call.output !== undefined ? jsonPreview(call.output) : '';
  return (
    <div className="bg-muted min-w-0 overflow-hidden rounded px-3 py-2 text-sm">
      <Text as="div" variant="label">
        {call.name}
      </Text>
      {(input.length > 0 || output.length > 0) && (
        <div className="mt-2 space-y-2">
          {input.length > 0 && (
            <div>
              <Text as="div" variant="caption" className="font-semibold">
                {t('messageInfo.input')}:
              </Text>
              <Text
                as="div"
                variant="caption"
                className="max-h-20 overflow-y-auto font-mono break-all"
              >
                {input}
              </Text>
            </div>
          )}
          {output.length > 0 && (
            <div>
              <Text as="div" variant="caption" className="font-semibold">
                {t('messageInfo.output')}:
              </Text>
              <Text
                as="div"
                variant="caption"
                className="max-h-20 overflow-y-auto font-mono break-all"
              >
                {output}
              </Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A titled block of the panel. The dialog title is the page's `h2`, so
 * each block is an `h3`. */
function InfoSection({
  title,
  meta,
  children,
}: {
  title: string;
  /** A short caption beside the title, e.g. a total. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3"
    >
      <Row gap={2} justify="between" align="baseline" wrap>
        <Heading id={headingId} level={3} size="sm">
          {title}
        </Heading>
        {meta !== undefined && (
          <Text as="span" variant="caption" className="tabular-nums">
            {meta}
          </Text>
        )}
      </Row>
      {children}
    </section>
  );
}

/** The three headline timings, as one divided strip. A label that wraps
 * (German and French run long) keeps its lines tight, and every value sits
 * on the strip's floor so the numbers line up across the cells. */
function MetricStrip({
  items,
}: {
  items: readonly { label: string; value: string }[];
}) {
  return (
    <dl
      className={cn(
        'border-border-base bg-border-base grid gap-px overflow-hidden rounded-lg border',
        // As many columns as cells: an empty track would show the divider
        // colour as a blank grey cell.
        items.length >= 3
          ? 'grid-cols-3'
          : items.length === 2
            ? 'grid-cols-2'
            : 'grid-cols-1',
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-bg-base flex min-w-0 flex-col justify-between gap-1 px-3 py-2.5"
        >
          <dt className="text-muted-foreground text-xs leading-4 wrap-break-word hyphens-auto">
            {item.label}
          </dt>
          <dd className="text-foreground text-base font-semibold tracking-tight tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const PHASE_COLOR: Record<ReplyPhaseKind, string> = {
  preparing: 'bg-chart-neutral/40',
  waiting: 'bg-chart-neutral/75',
  thinking: 'bg-chart-primary/45',
  tools: 'bg-chart-2',
  writing: 'bg-chart-primary',
};

/** Where the reply's time went: one bar of consecutive phases and its
 * legend. The bar is decoration — the legend carries every number. */
function PhaseTimeline({
  usage,
  parts,
  locale,
  t,
}: {
  usage: ChatMessageUsage;
  parts: readonly MessagePart[];
  locale: string;
  t: Translate;
}) {
  const phases = replyPhases(usage, parts);
  const total = phases.reduce((sum, phase) => sum + phase.durationMs, 0);
  if (phases.length < 2 || total <= 0) return null;
  return (
    <Stack gap={2}>
      <div aria-hidden className="flex h-2 w-full gap-0.5">
        {phases.map((phase) => (
          <div
            key={phase.kind}
            className={cn(
              'h-full min-w-1 rounded-full',
              PHASE_COLOR[phase.kind],
            )}
            style={{ flexGrow: phase.durationMs, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {phases.map((phase) => (
          <li key={phase.kind} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className={cn(
                'size-2 shrink-0 rounded-full',
                PHASE_COLOR[phase.kind],
              )}
            />
            <span className="text-muted-foreground">
              {t(`messageInfo.phases.${phase.kind}`)}
            </span>
            <span className="text-foreground tabular-nums">
              {formatMs(phase.durationMs, locale)}
            </span>
          </li>
        ))}
      </ul>
    </Stack>
  );
}

export function MessageInfoDialog({
  message,
  threadId,
  organizationId,
  open,
  onOpenChange,
}: {
  message: ChatMessageView;
  /** The conversation the message belongs to. Absent on surfaces without a
   * thread context — the voice-output section is skipped then. */
  threadId?: string;
  /** The org the voice-usage read is scoped to; absent skips the section. */
  organizationId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { formatDate, locale } = useFormatDate();
  const { serverEpochNow } = useClockOffset();
  const { copied: idCopied, onClick: handleCopyId } = useCopyButton(message.id);
  const names = useComposerModelNames(
    organizationId,
    message.model,
    message.providerSlug,
  );
  // Skip the query while the dialog is closed or the thread is unknown —
  // most open-close cycles never look at the section, and gating on `open`
  // keeps the steady-state cost at zero. Read through the chat seam, which
  // degrades to unavailable (section hidden) on a provider-less render
  // instead of throwing.
  const voice = useTanstackQuery(
    {
      ...messageVoiceUsageQuery(
        organizationId ?? '',
        message.id,
        threadId ?? '',
      ),
      enabled: open && threadId !== undefined && organizationId !== undefined,
    },
    useChatQueryClient(),
  );
  const voiceUsage = voice.data ?? undefined;

  const usage: ChatMessageUsage = message.usage ?? {};
  const toolCalls = pairToolCalls(message.parts);
  const serving = readServing(usage);

  // ── Model and where it ran ──
  const modelRows: StatGridItem[] = [];
  if (message.providerSlug !== undefined) {
    modelRows.push({
      label: t('messageInfo.provider'),
      value: <Text as="span">{names.provider ?? message.providerSlug}</Text>,
    });
  }
  if (serving.providers.length > 0) {
    modelRows.push({
      label: t('messageInfo.servedBy'),
      value: <Text as="span">{serving.providers.join(', ')}</Text>,
    });
  }
  const regionNames = serving.regions.map((region) => regionLabel(region, t));
  modelRows.push({
    label: t('messageInfo.region'),
    value:
      regionNames.length > 0 || serving.endpoint !== undefined ? (
        <Stack gap={1}>
          <Text as="span">
            {regionNames.length > 0
              ? regionNames.join(', ')
              : serving.endpoint !== undefined
                ? endpointRegionLabel(serving.endpoint.region, t)
                : null}
          </Text>
          {serving.endpoint !== undefined && (
            <Text as="span" variant="caption">
              {t('messageInfo.regionFromEndpoint', {
                host: serving.endpoint.host,
              })}
            </Text>
          )}
        </Stack>
      ) : (
        <Stack gap={1}>
          <Text as="span" variant="muted">
            {t('messageInfo.regionNotReported')}
          </Text>
          <Text as="span" variant="caption">
            {t('messageInfo.regionNotReportedHint')}
          </Text>
        </Stack>
      ),
  });
  if (serving.models.length > 0) {
    modelRows.push({
      label: t('messageInfo.modelVersion'),
      value: (
        <Text as="span" className="font-mono text-xs break-all">
          {serving.models.join(', ')}
        </Text>
      ),
    });
  }

  // ── Speed ──
  const tokensPerSecond = outputTokensPerSecond(usage, message.parts);
  const metrics: { label: string; value: string }[] = [];
  if (usage.timeToFirstTokenMs !== undefined) {
    metrics.push({
      label: t('messageInfo.timeToFirstToken'),
      value: formatMs(usage.timeToFirstTokenMs, locale),
    });
  }
  if (tokensPerSecond !== undefined) {
    metrics.push({
      label: t('messageInfo.throughput'),
      value: t('messageInfo.tokensPerSecond', {
        value: formatNumber(Math.round(tokensPerSecond), locale),
      }),
    });
  }
  if (usage.durationMs !== undefined) {
    metrics.push({
      label: t('messageInfo.duration'),
      value: formatMs(usage.durationMs, locale),
    });
  }
  const hasPerf = metrics.length > 0 || usage.perceivedWaitMs !== undefined;

  // ── Tokens ──
  const tokenRows: StatGridItem[] = [];
  if (usage.inputTokens !== undefined && usage.inputTokens > 0) {
    const cached =
      usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0
        ? usage.cachedInputTokens
        : undefined;
    tokenRows.push({
      label: t('messageInfo.input'),
      value: (
        <Text as="span" className="tabular-nums">
          {formatNumber(usage.inputTokens, locale)}
          {cached !== undefined && (
            <Text as="span" variant="caption">
              {' · '}
              {t('messageInfo.cachedTokens', {
                count: formatNumber(cached, locale),
                percent: Math.round((cached / usage.inputTokens) * 100),
              })}
            </Text>
          )}
        </Text>
      ),
    });
  }
  if (usage.outputTokens !== undefined && usage.outputTokens > 0) {
    const reasoning =
      usage.reasoningTokens !== undefined && usage.reasoningTokens > 0
        ? usage.reasoningTokens
        : undefined;
    tokenRows.push({
      label: t('messageInfo.output'),
      value: (
        <Text as="span" className="tabular-nums">
          {formatNumber(usage.outputTokens, locale)}
          {reasoning !== undefined && (
            <Text as="span" variant="caption">
              {' · '}
              {t('messageInfo.reasoningTokens', {
                count: formatNumber(reasoning, locale),
              })}
            </Text>
          )}
        </Text>
      ),
    });
  }
  if (usage.costEstimateCents !== undefined) {
    tokenRows.push({
      label: t('messageInfo.cost'),
      value: (
        <Text as="span" className="tabular-nums">
          {formatCostCents(usage.costEstimateCents, 'USD', locale)}
        </Text>
      ),
    });
  }
  const totalTokens =
    usage.totalTokens !== undefined && usage.totalTokens > 0
      ? usage.totalTokens
      : undefined;

  const noMetadata =
    tokenRows.length === 0 && !hasPerf && message.model === undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('messageInfo.title')}
      size="md"
      className="md:max-w-[520px]"
    >
      {/* shrink-0, not overflow-hidden: hidden on a flex child zeroes
          min-height and clips the sections the body should scroll. */}
      <Stack gap={6} className="min-w-0 shrink-0">
        {message.model !== undefined && (
          <InfoSection title={t('messageInfo.model')}>
            <div className="min-w-0">
              <Text as="div" variant="label" className="text-base">
                {names.model ?? message.model}
              </Text>
              {names.model !== undefined && (
                <Text
                  as="div"
                  variant="caption"
                  className="font-mono break-all"
                >
                  {message.model}
                </Text>
              )}
            </div>
            <StatGrid layout="rows" className="text-sm" items={modelRows} />
          </InfoSection>
        )}

        {hasPerf && (
          <InfoSection title={t('messageInfo.performance')}>
            {metrics.length > 0 && <MetricStrip items={metrics} />}
            <PhaseTimeline
              usage={usage}
              parts={message.parts}
              locale={locale}
              t={t}
            />
            {usage.perceivedWaitMs !== undefined && (
              <Text as="div" variant="caption">
                {t('messageInfo.perceivedWait', {
                  duration: formatMs(usage.perceivedWaitMs, locale),
                })}
              </Text>
            )}
          </InfoSection>
        )}

        {tokenRows.length > 0 && (
          <InfoSection
            title={t('messageInfo.tokenUsage')}
            {...(totalTokens !== undefined
              ? {
                  meta: t('messageInfo.totalTokens', {
                    count: formatNumber(totalTokens, locale),
                  }),
                }
              : {})}
          >
            <StatGrid layout="rows" className="text-sm" items={tokenRows} />
          </InfoSection>
        )}

        {voiceUsage != null && voiceUsage.breakdown.length > 0 && (
          <InfoSection title={t('messageInfo.voiceOutput')}>
            <Stack gap={2}>
              {voiceUsage.breakdown.map((entry, index) => (
                <div
                  key={`${entry.provider}-${entry.model}-${entry.voice ?? ''}-${index}`}
                  className="bg-muted min-w-0 overflow-hidden rounded px-3 py-2 text-sm"
                >
                  <Text as="div" variant="label">
                    {entry.model}
                    <Text
                      as="span"
                      variant="muted"
                      className="ml-2 font-normal"
                    >
                      ({entry.provider})
                    </Text>
                  </Text>
                  <Text as="div" variant="caption" className="mt-0.5">
                    {entry.voice !== undefined && (
                      <>
                        {t('messageInfo.voice')}: {entry.voice}
                        {' · '}
                      </>
                    )}
                    {t('messageInfo.voiceCharacters')}:{' '}
                    {formatNumber(entry.characters, locale)}
                    {' · '}
                    {t('messageInfo.cost')}:{' '}
                    {formatCostCents(entry.costCents, 'USD', locale)}
                  </Text>
                </div>
              ))}
              {voiceUsage.breakdown.length > 1 && (
                <Text as="div" variant="caption" className="px-1">
                  {t('messageInfo.voiceCharacters')}:{' '}
                  {formatNumber(voiceUsage.totalCharacters, locale)}
                  {' · '}
                  {t('messageInfo.cost')}:{' '}
                  {formatCostCents(voiceUsage.totalCostCents, 'USD', locale)}
                </Text>
              )}
            </Stack>
          </InfoSection>
        )}

        {toolCalls.length > 0 && (
          <InfoSection title={t('messageInfo.toolCalls')}>
            <Stack gap={2}>
              {toolCalls.map((call) => (
                <ToolCallCard key={call.callId} call={call} t={t} />
              ))}
            </Stack>
          </InfoSection>
        )}

        {message.blockedReason !== undefined && (
          <InfoSection title={t('messageInfo.blockedReason')}>
            <Text as="div" className="text-sm">
              {message.blockedReason}
            </Text>
          </InfoSection>
        )}
        {message.error !== undefined && (
          <InfoSection title={t('messageInfo.error')}>
            <Text as="div" className="text-sm">
              {message.error}
            </Text>
          </InfoSection>
        )}

        {noMetadata && (
          <Text as="div" variant="muted">
            {t('messageInfo.noMetadata')}
          </Text>
        )}

        {/* The record's identifiers close the panel, quietly. */}
        <dl className="border-border flex min-w-0 flex-col gap-2 border-t pt-4 text-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-baseline gap-x-4">
            <dt className="text-muted-foreground">
              {t('messageInfo.timestamp')}
            </dt>
            <dd className="text-foreground min-w-0">
              {formatDate(new Date(message.createdAt), 'long')}
              <span className="text-muted-foreground">
                {' · '}
                {formatRelativeTime(
                  message.createdAt,
                  locale,
                  serverEpochNow(),
                )}
              </span>
            </dd>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-x-4">
            <dt className="text-muted-foreground">
              {t('messageInfo.messageId')}
            </dt>
            <dd className="flex min-w-0 items-center gap-1">
              <Text
                as="span"
                variant="code"
                className="text-foreground min-w-0 flex-1 truncate"
              >
                {message.id}
              </Text>
              <IconButton
                icon={idCopied ? Check : Copy}
                size="sm"
                aria-label={
                  idCopied ? tCommon('actions.copied') : t('messageInfo.copyId')
                }
                onClick={handleCopyId}
              />
            </dd>
          </div>
        </dl>
      </Stack>
    </Dialog>
  );
}
