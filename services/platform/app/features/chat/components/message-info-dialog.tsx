'use client';

/**
 * The per-message info panel: when the message was sent, what model answered,
 * what it cost in tokens and dollars, how fast it was, and what the turn's
 * tools were asked and answered.
 *
 * Everything renders from the message row itself — `usage` is the blob the
 * turn pipeline stamped, read defensively because a turn records only what
 * its lane could measure. Fields a turn did not record are hidden rather
 * than zero-filled, so the panel never invents a number. The one live read
 * is the voice-output breakdown, through the chat seam (`useChatQuery`),
 * fetched only while the dialog is open.
 *
 * The shell is the base `Dialog`, not `ViewDialog`: the toolbar mounts this
 * on surfaces (and in tests) with no router in scope, and `ViewDialog`'s
 * error boundary reads the org id from route params.
 */

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { useClockOffset } from '@/app/hooks/use-clock-offset';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';
import { formatRelativeTime } from '@/lib/utils/format/relative-time';

import { useChatQuery } from '../data/chat-backend';
import type { ChatMessageUsage, ChatMessageView, MessagePart } from '../types';

/** A duration for humans: sub-second stays in ms, everything else in s. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
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

function ToolCallCard({
  call,
  t,
}: {
  call: ToolCallView;
  t: (key: string) => string;
}) {
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

export function MessageInfoDialog({
  message,
  threadId,
  open,
  onOpenChange,
}: {
  message: ChatMessageView;
  /** The conversation the message belongs to. Absent on surfaces without a
   * thread context — the voice-output section is skipped then. */
  threadId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { formatDate, locale } = useFormatDate();
  const { serverEpochNow } = useClockOffset();
  const { copied: idCopied, onClick: handleCopyId } = useCopyButton(message.id);
  // Drill-in router: the clickable TTFT cell swaps the dialog body for the
  // breakdown in place (single surface, Back returns) — never a nested
  // dialog. Reset on close so a reopen starts at the main view.
  const [view, setView] = useState<'main' | 'ttft'>('main');
  const handleOpenChange = (next: boolean) => {
    if (!next) setView('main');
    onOpenChange(next);
  };
  // Skip the query while the dialog is closed or the thread is unknown —
  // most open-close cycles never look at the section, and gating on `open`
  // keeps the steady-state cost at zero. Read through the chat seam, which
  // degrades to unavailable (section hidden) on a provider-less render
  // instead of throwing.
  const voice = useChatQuery(
    api.tts.queries.getMessageVoiceUsage,
    open && threadId !== undefined
      ? { messageId: message.id, threadId }
      : 'skip',
  );
  const voiceUsage = voice.status === 'ready' ? voice.data : undefined;

  const usage: ChatMessageUsage = message.usage ?? {};
  const toolCalls = pairToolCalls(message.parts);

  const tokenItems: StatGridItem[] = [];
  const pushCount = (label: string, value: number | undefined): void => {
    if (value === undefined || value <= 0) return;
    tokenItems.push({
      label,
      value: <Text>{formatNumber(value, locale)}</Text>,
    });
  };
  pushCount(t('messageInfo.input'), usage.inputTokens);
  pushCount(t('messageInfo.output'), usage.outputTokens);
  pushCount(t('messageInfo.total'), usage.totalTokens);
  pushCount(t('messageInfo.reasoning'), usage.reasoningTokens);
  if (usage.cachedInputTokens !== undefined && usage.cachedInputTokens > 0) {
    // For cached input tokens, show what share of the input was a cache
    // hit — the headline cost lever for repeated prompts.
    const percent =
      usage.inputTokens !== undefined && usage.inputTokens > 0
        ? Math.round((usage.cachedInputTokens / usage.inputTokens) * 100)
        : undefined;
    tokenItems.push({
      label: t('messageInfo.cached'),
      value: (
        <Text>
          {formatNumber(usage.cachedInputTokens, locale)}
          {percent !== undefined && (
            <>
              {' '}
              <Text as="span" variant="muted" className="text-xs">
                ({t('messageInfo.cachedPercent', { percent })})
              </Text>
            </>
          )}
        </Text>
      ),
    });
  }
  if (usage.costEstimateCents !== undefined) {
    tokenItems.push({
      label: t('messageInfo.cost'),
      value: (
        <Text className="font-mono">
          {formatCostCents(usage.costEstimateCents, 'USD', locale)}
        </Text>
      ),
    });
  }

  // The breakdown view exists once the pipeline stamped any anchor beyond
  // the headline TTFT — then the headline cell becomes its doorway.
  const hasTtftBreakdown =
    usage.timeToFirstTokenMs !== undefined &&
    (usage.setupMs !== undefined || usage.timeToFirstReasoningMs !== undefined);

  // Two groups, two clocks. Your wait is click → first paint; Server
  // times share one origin (reply start) so first-token sits inside done.
  const yourWaitItems: StatGridItem[] = [];
  if (usage.perceivedWaitMs !== undefined) {
    yourWaitItems.push({
      label: t('messageInfo.youWaited'),
      value: <Text>{formatMs(usage.perceivedWaitMs)}</Text>,
    });
  }
  const serverItems: StatGridItem[] = [];
  if (usage.timeToFirstTokenMs !== undefined) {
    const ttft = formatMs(usage.timeToFirstTokenMs);
    serverItems.push({
      label: t('messageInfo.timeToFirstToken'),
      value: hasTtftBreakdown ? (
        <button
          type="button"
          onClick={() => setView('ttft')}
          className="cursor-pointer text-left font-medium hover:underline"
        >
          {ttft}
        </button>
      ) : (
        <Text>{ttft}</Text>
      ),
    });
  }
  if (usage.durationMs !== undefined) {
    serverItems.push({
      label: t('messageInfo.duration'),
      value: <Text>{formatMs(usage.durationMs)}</Text>,
    });
  }
  // Generation-only throughput: tokens after the first SSE, not the
  // whole duration (setup + wait-for-first-byte would understate tok/s,
  // and TTFT === duration leaves no generation window).
  const generationMs =
    usage.durationMs !== undefined && usage.timeToFirstTokenMs !== undefined
      ? usage.durationMs - usage.timeToFirstTokenMs
      : undefined;
  if (
    usage.outputTokens !== undefined &&
    usage.outputTokens > 0 &&
    generationMs !== undefined &&
    generationMs > 0
  ) {
    const tps = usage.outputTokens / (generationMs / 1000);
    serverItems.push({
      label: t('messageInfo.throughput'),
      value: (
        <Text>
          {t('messageInfo.tokensPerSecond', {
            value: formatNumber(Math.round(tps), locale),
          })}
        </Text>
      ),
    });
  }
  const hasPerf = yourWaitItems.length > 0 || serverItems.length > 0;

  const noMetadata =
    tokenItems.length === 0 && !hasPerf && message.model === undefined;

  if (view === 'ttft') {
    const breakdownItems: StatGridItem[] = [];
    if (usage.setupMs !== undefined) {
      breakdownItems.push({
        label: t('messageInfo.setupBeforeModel'),
        value: <Text>{formatMs(usage.setupMs)}</Text>,
      });
    }
    if (usage.timeToFirstReasoningMs !== undefined) {
      breakdownItems.push({
        label: t('messageInfo.timeToFirstReasoning'),
        value: <Text>{formatMs(usage.timeToFirstReasoningMs)}</Text>,
      });
    }
    if (usage.timeToFirstTokenMs !== undefined) {
      breakdownItems.push({
        label: t('messageInfo.timeToFirstToken'),
        value: <Text>{formatMs(usage.timeToFirstTokenMs)}</Text>,
      });
    }
    return (
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('messageInfo.ttftDetailsTitle')}
        description={t('messageInfo.ttftDetailsDescription')}
        size="md"
        className="md:max-w-[500px]"
      >
        <FieldGroup gap={4} className="min-w-0 shrink-0">
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setView('main')}
              className="-ml-2 h-7"
            >
              <ArrowLeft aria-hidden className="mr-1 size-3.5" />
              {tCommon('actions.back')}
            </Button>
          </div>
          <Field label={t('messageInfo.ttftBreakdown')}>
            <StatGrid className="text-sm" items={breakdownItems} />
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground mt-1"
            >
              {t('messageInfo.ttftBreakdownHint')}
            </Text>
          </Field>
        </FieldGroup>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('messageInfo.title')}
      description={t('messageInfo.description')}
      size="md"
      className="md:max-w-[500px]"
    >
      {/* shrink-0, not overflow-hidden: hidden on a flex child zeroes
          min-height and clips the clocks the body should scroll. */}
      <FieldGroup gap={4} className="min-w-0 shrink-0">
        <Field label={t('messageInfo.timestamp')}>
          <Text as="div">
            {formatDate(new Date(message.createdAt), 'long')}
          </Text>
          <Text as="div" variant="muted" className="text-xs">
            {formatRelativeTime(message.createdAt, locale, serverEpochNow())}
          </Text>
        </Field>

        <Field label={t('messageInfo.messageId')}>
          <Row gap={1}>
            <Text
              as="div"
              variant="code"
              className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1"
            >
              {message.id}
            </Text>
            <IconButton
              icon={idCopied ? Check : Copy}
              aria-label={
                idCopied ? tCommon('actions.copied') : t('messageInfo.copyId')
              }
              onClick={handleCopyId}
            />
          </Row>
        </Field>

        {message.model !== undefined && (
          <Field label={t('messageInfo.model')}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{message.model}</Badge>
              {message.providerSlug !== undefined && (
                <Text as="span" variant="muted" className="text-xs">
                  {message.providerSlug}
                </Text>
              )}
            </div>
          </Field>
        )}

        {tokenItems.length > 0 && (
          <Field label={t('messageInfo.tokenUsage')}>
            <StatGrid className="text-sm" items={tokenItems} />
          </Field>
        )}

        {hasPerf && (
          <Field label={t('messageInfo.performance')}>
            {yourWaitItems.length > 0 && (
              <div>
                <Text as="div" variant="label" className="mb-1">
                  {t('messageInfo.yourWait')}
                </Text>
                <StatGrid className="text-sm" items={yourWaitItems} />
              </div>
            )}
            {serverItems.length > 0 && (
              <div className={yourWaitItems.length > 0 ? 'mt-3' : undefined}>
                <Text as="div" variant="label" className="mb-1">
                  {t('messageInfo.serverTiming')}
                </Text>
                <StatGrid className="text-sm" items={serverItems} />
              </div>
            )}
            {yourWaitItems.length > 0 && (
              <Text
                as="div"
                variant="caption"
                className="text-muted-foreground mt-1"
              >
                {t('messageInfo.performanceHint')}
              </Text>
            )}
          </Field>
        )}

        {voiceUsage != null && voiceUsage.breakdown.length > 0 && (
          <Field label={t('messageInfo.voiceOutput')}>
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
          </Field>
        )}

        {toolCalls.length > 0 && (
          <Field label={t('messageInfo.toolCalls')}>
            <Stack gap={2}>
              {toolCalls.map((call) => (
                <ToolCallCard key={call.callId} call={call} t={t} />
              ))}
            </Stack>
          </Field>
        )}

        {message.blockedReason !== undefined && (
          <Field label={t('messageInfo.blockedReason')}>
            <Text as="div" className="text-sm">
              {message.blockedReason}
            </Text>
          </Field>
        )}
        {message.error !== undefined && (
          <Field label={t('messageInfo.error')}>
            <Text as="div" className="text-sm">
              {message.error}
            </Text>
          </Field>
        )}

        {noMetadata && (
          <Text as="div" variant="muted">
            {t('messageInfo.noMetadata')}
          </Text>
        )}
      </FieldGroup>
    </Dialog>
  );
}
