'use client';

import { Badge } from '@tale/ui/badge';
import { IconButton } from '@tale/ui/icon-button';
import { Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useAction } from 'convex/react';
import { Copy, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';
import { formatRelativeTime } from '@/lib/utils/format/relative-time';

import type { MessageMetadata, ToolUsage } from '../hooks/queries';

function formatCostDollars(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return '$0.00';
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toPrecision(3)}`;
}

function formatAgentName(toolName: string): string {
  const nameMap: Record<string, string> = {
    crm_assistant: 'CRM',
    integration_assistant: 'Integration',
    workflow_assistant: 'Workflow',
  };
  return nameMap[toolName] ?? toolName;
}

interface ContextWindowTokenProps {
  contextWindow: string;
  contextStats?: MessageMetadata['contextStats'];
  t: (key: string) => string;
  tCommon: (key: string) => string;
  locale: string;
}

function ContextWindowToken({
  contextWindow,
  contextStats,
  t,
  tCommon,
  locale,
}: ContextWindowTokenProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { copied, onClick: handleCopy } = useCopyButton(contextWindow);
  const tokenCount = contextStats?.totalTokens ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        className="cursor-pointer text-left font-medium hover:underline"
      >
        ~{formatNumber(tokenCount, locale)}
      </button>

      <ViewDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={t('messageInfo.contextWindow')}
        description={t('messageInfo.contextWindowDescription')}
        className="max-h-[80vh] sm:max-w-[800px]"
        headerActions={
          <IconButton
            icon={copied ? Check : Copy}
            aria-label={
              copied ? tCommon('actions.copied') : tCommon('actions.copy')
            }
            onClick={handleCopy}
          />
        }
      >
        <div className="context-window-content [&_details]:border-border [&_details_summary]:bg-muted [&_details[open]_summary]:border-border [&_details_h3]:border-border/50 max-h-[60vh] overflow-auto [&_details]:mb-2 [&_details]:overflow-hidden [&_details]:rounded-md [&_details]:border [&_details_h3]:border-b [&_details_h3]:!pt-4 [&_details_h3]:!pb-1.5 [&_details_h3]:!text-sm [&_details_h3]:!font-semibold [&_details_h3:first-of-type]:!pt-0 [&_details_summary]:cursor-pointer [&_details_summary]:list-none [&_details_summary]:px-3 [&_details_summary]:py-2 [&_details_summary]:font-medium [&_details>*:not(summary)]:overflow-x-auto [&_details>*:not(summary)]:p-3 [&_details>*:not(summary)]:font-mono [&_details>*:not(summary)]:text-xs [&_details>*:not(summary)]:whitespace-pre-wrap [&_details[open]_summary]:border-b">
          <Markdown
            rehypePlugins={[
              rehypeRaw,
              [
                rehypeSanitize,
                {
                  ...defaultSchema,
                  tagNames: [
                    ...(defaultSchema.tagNames ?? []),
                    'details',
                    'summary',
                  ],
                },
              ],
            ]}
            remarkPlugins={[remarkGfm]}
          >
            {contextWindow}
          </Markdown>
        </div>
      </ViewDialog>
    </>
  );
}

interface ToolCallCardProps {
  usage: ToolUsage;
  locale: string;
  t: (key: string) => string;
}

function ToolCallCard({ usage, locale, t }: ToolCallCardProps) {
  return (
    <div className="bg-muted min-w-0 overflow-hidden rounded px-3 py-2 text-sm">
      <Text as="div" variant="label">
        {formatAgentName(usage.toolName)}
        {usage.model && (
          <Text as="span" variant="muted" className="ml-2 font-normal">
            {usage.model}
            {usage.provider && ` (${usage.provider})`}
          </Text>
        )}
      </Text>
      {usage.totalTokens !== undefined && (
        <Text as="div" variant="caption" className="mt-0.5">
          {t('messageInfo.input')}:{' '}
          {formatNumber(usage.inputTokens ?? 0, locale)}
          {' · '}
          {t('messageInfo.output')}:{' '}
          {formatNumber(usage.outputTokens ?? 0, locale)}
          {' · '}
          {t('messageInfo.total')}: {formatNumber(usage.totalTokens, locale)}
          {usage.costEstimateCents != null && (
            <>
              {' · '}
              Cost: {formatCostDollars(usage.costEstimateCents)}
            </>
          )}
          {usage.durationMs !== undefined && (
            <>
              {' · '}
              {t('messageInfo.duration')}:{' '}
              {(usage.durationMs / 1000).toFixed(2)}s
            </>
          )}
        </Text>
      )}
      {(usage.input || usage.output) && (
        <div className="mt-2 space-y-2">
          {usage.input && (
            <div>
              <Text as="div" variant="caption" className="font-semibold">
                {t('toolDetails.input')}:
              </Text>
              <Text
                as="div"
                variant="caption"
                className="max-h-20 overflow-y-auto font-mono break-all"
              >
                {usage.input}
              </Text>
            </div>
          )}
          {usage.output && (
            <div>
              <Text as="div" variant="caption" className="font-semibold">
                {t('toolDetails.output')}:
              </Text>
              <Text
                as="div"
                variant="caption"
                className="max-h-20 overflow-y-auto font-mono break-all"
              >
                {usage.output}
              </Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dev-only "direct HTTP" TTFT probe. Renders nothing unless the current user
 * is on the probe allowlist (server-checked via `canRunDirectTtft`; the action
 * re-checks, so this gate is advisory). Streams the prompt straight to the
 * model — no tools/RAG/history — to measure the raw model+network floor, for
 * comparison against the pipeline metrics shown above (the gap is our overhead).
 */
function DirectTtftProbe({
  organizationId,
  modelId,
  pipelineFirstReasoningMs,
  pipelineTimeFromSendMs,
}: {
  organizationId: string;
  modelId?: string;
  pipelineFirstReasoningMs?: number;
  pipelineTimeFromSendMs?: number;
}) {
  const { data: canRun } = useConvexQuery(
    api.debug.queries.canRunDirectTtft,
    {},
  );
  const runProbe = useAction(api.debug.direct_ttft.measureDirectTtft);
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof runProbe>
  > | null>(null);

  if (!canRun) return null;

  const fmt = (ms?: number) =>
    ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;

  const onRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await runProbe({
          organizationId,
          message: message.trim() || 'Reply with a one-sentence greeting.',
          ...(modelId ? { modelId } : {}),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Field label="Direct TTFT probe (dev)">
      <Stack gap={2}>
        <Text as="div" variant="caption" className="text-muted-foreground">
          Streams this prompt straight to {modelId ?? 'the chat model'} with no
          tools / RAG / history — the raw model + network floor. Compare with
          the pipeline numbers above; the gap is backend overhead. Issues a real
          (billed) call, aborted at first content.
        </Text>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Probe prompt (defaults to a short greeting)"
          rows={2}
          className="bg-muted w-full rounded px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="bg-primary text-primary-foreground w-fit rounded px-3 py-1 text-sm font-medium disabled:opacity-50"
        >
          {running ? 'Measuring…' : 'Measure direct TTFT'}
        </button>
        {error && (
          <Text as="div" variant="caption" className="text-destructive">
            {error}
          </Text>
        )}
        {result && (
          <StatGrid
            className="text-sm"
            items={[
              {
                label: 'Direct first-reasoning',
                value: <Text>{fmt(result.firstReasoningMs)}</Text>,
              },
              {
                label: 'Direct first-content',
                value: <Text>{fmt(result.firstContentMs)}</Text>,
              },
              {
                label: 'Direct TTFB',
                value: <Text>{fmt(result.ttfbMs)}</Text>,
              },
              ...(pipelineFirstReasoningMs != null
                ? [
                    {
                      label: 'Pipeline first-reasoning',
                      value: <Text>{fmt(pipelineFirstReasoningMs)}</Text>,
                    },
                  ]
                : []),
              ...(pipelineTimeFromSendMs != null
                ? [
                    {
                      label: 'Pipeline from-send',
                      value: <Text>{fmt(pipelineTimeFromSendMs)}</Text>,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Stack>
    </Field>
  );
}

interface MessageInfoDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  // Optional because the message bubble's threadId may be missing in
  // transient states (e.g. mid-fork). The Voice output section is only
  // fetched when both ids are available.
  threadId?: string;
  timestamp: Date;
  metadata?: MessageMetadata;
  /** Owning org — enables the dev-only direct-TTFT probe when present. */
  organizationId?: string;
}

export function MessageInfoDialog({
  isOpen,
  onOpenChange,
  messageId,
  threadId,
  timestamp,
  metadata,
  organizationId,
}: MessageInfoDialogProps) {
  const { formatDate, locale } = useFormatDate();
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { copied: idCopied, onClick: handleCopyId } = useCopyButton(messageId);
  // Skip the query while the dialog is closed — most opens-close cycles
  // wouldn't ever look at the section, and TTS chunks subscribe is cheap
  // enough that gating on `isOpen` keeps the steady-state cost at zero.
  const { data: voiceUsage } = useConvexQuery(
    api.tts.queries.getMessageVoiceUsage,
    isOpen && threadId ? { messageId, threadId } : 'skip',
  );
  const tokenItems = useMemo<StatGridItem[]>(
    () => [
      ...(metadata?.contextWindow
        ? [
            {
              label: t('messageInfo.contextWindow'),
              value: (
                <ContextWindowToken
                  contextWindow={metadata.contextWindow}
                  contextStats={metadata.contextStats}
                  t={t}
                  tCommon={tCommon}
                  locale={locale}
                />
              ),
            },
          ]
        : []),
      ...(
        [
          [metadata?.inputTokens, 'input'],
          [metadata?.outputTokens, 'output'],
          [metadata?.totalTokens, 'total'],
          [metadata?.reasoningTokens, 'reasoning'],
          [metadata?.cachedInputTokens, 'cached'],
        ] as [number | undefined, string][]
      )
        .filter(
          (entry): entry is [number, string] =>
            entry[0] != null && entry[0] > 0,
        )
        .map(([value, key]) => {
          // For cached input tokens, show what share of the input was a
          // cache hit — the headline cost lever for repeated prompts.
          if (
            key === 'cached' &&
            metadata?.inputTokens != null &&
            metadata.inputTokens > 0
          ) {
            const percent = Math.round((value / metadata.inputTokens) * 100);
            return {
              label: t(`messageInfo.${key}`),
              value: (
                <Text>
                  {formatNumber(value, locale)}{' '}
                  <Text as="span" variant="muted" className="text-xs">
                    ({t('messageInfo.cachedPercent', { percent })})
                  </Text>
                </Text>
              ),
            };
          }
          return {
            label: t(`messageInfo.${key}`),
            value: <Text>{formatNumber(value, locale)}</Text>,
          };
        }),
      ...(metadata?.costEstimateCents != null
        ? [
            {
              label: 'Cost',
              value: (
                <Text className="font-mono">
                  {formatCostDollars(metadata.costEstimateCents)}
                </Text>
              ),
            },
          ]
        : []),
    ],
    [metadata, t, tCommon, locale],
  );

  const perfItems = useMemo<StatGridItem[]>(() => {
    const items = (
      [
        [metadata?.durationMs, 'duration'],
        // Causal order: send → first thinking token → first answer token.
        [metadata?.timeFromSendMs, 'timeFromSend'],
        [metadata?.timeToFirstReasoningMs, 'timeToFirstReasoning'],
        [metadata?.timeToFirstTokenMs, 'timeToFirstToken'],
      ] as [number | undefined, string][]
    )
      .filter((entry): entry is [number, string] => entry[0] != null)
      .map(([value, key]) => ({
        label: t(`messageInfo.${key}`),
        value: <Text>{(value / 1000).toFixed(2)}s</Text>,
      }));

    // Derived throughput: output tokens per second of generation. Only when
    // both signals exist and duration is non-zero.
    if (
      metadata?.outputTokens != null &&
      metadata.outputTokens > 0 &&
      metadata.durationMs != null &&
      metadata.durationMs > 0
    ) {
      const tps = metadata.outputTokens / (metadata.durationMs / 1000);
      items.push({
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

    return items;
  }, [
    metadata?.durationMs,
    metadata?.timeFromSendMs,
    metadata?.timeToFirstReasoningMs,
    metadata?.timeToFirstTokenMs,
    metadata?.outputTokens,
    t,
    locale,
  ]);

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('messageInfo.title')}
      description={t('messageInfo.description')}
      className="sm:max-w-[500px]"
    >
      <FieldGroup gap={4} className="min-w-0 overflow-hidden">
        <Field label={t('messageInfo.timestamp')}>
          <Text as="div">{formatDate(timestamp, 'long')}</Text>
          <Text as="div" variant="muted" className="text-xs">
            {formatRelativeTime(timestamp, locale)}
          </Text>
        </Field>

        <Field label={t('messageInfo.messageId')}>
          <div className="flex items-center gap-1">
            <Text
              as="div"
              variant="code"
              className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1"
            >
              {messageId}
            </Text>
            <IconButton
              icon={idCopied ? Check : Copy}
              aria-label={
                idCopied ? tCommon('actions.copied') : t('messageInfo.copyId')
              }
              onClick={handleCopyId}
            />
          </div>
        </Field>

        {metadata ? (
          <>
            <Field label={t('messageInfo.model')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{metadata.model}</Badge>
                {metadata.provider && (
                  <Text as="span" variant="muted" className="text-xs">
                    {metadata.provider}
                  </Text>
                )}
              </div>
            </Field>

            {tokenItems.length > 0 && (
              <Field label={t('messageInfo.tokenUsage')}>
                <StatGrid className="text-sm" items={tokenItems} />
              </Field>
            )}

            {perfItems.length > 0 && (
              <Field label={t('messageInfo.performance')}>
                <StatGrid className="text-sm" items={perfItems} />
              </Field>
            )}

            {organizationId && (
              <DirectTtftProbe
                organizationId={organizationId}
                modelId={metadata.model}
                pipelineFirstReasoningMs={metadata.timeToFirstReasoningMs}
                pipelineTimeFromSendMs={metadata.timeFromSendMs}
              />
            )}

            {voiceUsage && voiceUsage.breakdown.length > 0 && (
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
                        {entry.voice && (
                          <>
                            {t('messageInfo.voice')}: {entry.voice}
                            {' · '}
                          </>
                        )}
                        {t('messageInfo.voiceCharacters')}:{' '}
                        {formatNumber(entry.characters, locale)}
                        {' · '}
                        Cost: {formatCostDollars(entry.costCents)}
                      </Text>
                    </div>
                  ))}
                  {voiceUsage.breakdown.length > 1 && (
                    <Text as="div" variant="caption" className="px-1">
                      {t('messageInfo.voiceCharacters')}:{' '}
                      {formatNumber(voiceUsage.totalCharacters, locale)}
                      {' · '}
                      Cost: {formatCostDollars(voiceUsage.totalCostCents)}
                    </Text>
                  )}
                </Stack>
              </Field>
            )}

            {metadata.toolsUsage && metadata.toolsUsage.length > 0 && (
              <Field label={t('messageInfo.toolCalls')}>
                <Stack gap={2}>
                  {metadata.toolsUsage.map((usage, index) => (
                    <ToolCallCard
                      key={`${usage.toolName}-${index}`}
                      usage={usage}
                      locale={locale}
                      t={t}
                    />
                  ))}
                </Stack>
              </Field>
            )}

            {metadata.reasoning && (
              <Field label={t('messageInfo.reasoning')}>
                <Text
                  as="div"
                  className="bg-muted max-h-40 overflow-y-auto rounded px-3 py-2"
                >
                  {metadata.reasoning}
                </Text>
              </Field>
            )}
          </>
        ) : (
          <Text as="div" variant="muted">
            {t('messageInfo.noMetadata')}
          </Text>
        )}
      </FieldGroup>
    </ViewDialog>
  );
}
