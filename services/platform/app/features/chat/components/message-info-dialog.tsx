'use client';

/**
 * The lean per-message info panel: when the message was sent, what model
 * answered, what it cost in tokens, and how fast it was.
 *
 * Everything renders from the message row itself — `usage` is the blob the
 * turn pipeline stamped, read defensively because a turn records only what
 * its lane could measure. Fields a turn did not record are hidden rather
 * than zero-filled, so the panel never invents a number.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Check, Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useCopy } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import type { ChatMessageUsage, ChatMessageView } from '../types';

/** A duration for humans: sub-second stays in ms, everything else in s. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Row gap={4} className="items-baseline justify-between text-sm">
      <Text variant="muted" className="shrink-0 text-sm">
        {label}
      </Text>
      <span className="min-w-0 text-right break-all">{children}</span>
    </Row>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      variant="muted"
      className="border-border mt-2 border-t pt-3 text-xs font-medium tracking-wide uppercase"
    >
      {children}
    </Text>
  );
}

export function MessageInfoDialog({
  message,
  open,
  onOpenChange,
}: {
  message: ChatMessageView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('chat');
  const { copied, copy } = useCopy();
  const { formatDate } = useFormatDate();

  const usage: ChatMessageUsage = message.usage ?? {};
  const toolCalls = message.parts.filter(
    (part) => part.type === 'tool-call',
  ).length;
  const throughput =
    usage.outputTokens !== undefined &&
    usage.durationMs !== undefined &&
    usage.durationMs > 0
      ? usage.outputTokens / (usage.durationMs / 1000)
      : undefined;
  const hasTokens =
    usage.inputTokens !== undefined ||
    usage.outputTokens !== undefined ||
    usage.totalTokens !== undefined;
  const hasPerformance =
    usage.durationMs !== undefined || usage.timeToFirstTokenMs !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('messageInfo.title')}
      size="md"
    >
      <Stack gap={2}>
        <InfoRow label={t('messageInfo.timestamp')}>
          {formatDate(new Date(message.createdAt), 'long')}
        </InfoRow>
        <InfoRow label={t('messageInfo.messageId')}>
          <Row gap={1} className="items-center justify-end">
            <code className="text-xs">{message.id}</code>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('messageInfo.copyId')}
              onClick={() => void copy(message.id)}
              className="size-6"
            >
              {copied ? (
                <Check aria-hidden className="text-success size-3" />
              ) : (
                <Copy aria-hidden className="size-3" />
              )}
            </Button>
          </Row>
        </InfoRow>
        {message.model !== undefined && (
          <InfoRow label={t('messageInfo.model')}>{message.model}</InfoRow>
        )}
        {message.providerSlug !== undefined && (
          <InfoRow label={t('messageInfo.provider')}>
            {message.providerSlug}
          </InfoRow>
        )}
        {toolCalls > 0 && (
          <InfoRow label={t('messageInfo.toolCalls')}>{toolCalls}</InfoRow>
        )}

        {hasTokens && (
          <>
            <SectionLabel>{t('messageInfo.tokenUsage')}</SectionLabel>
            {usage.inputTokens !== undefined && (
              <InfoRow label={t('messageInfo.input')}>
                {usage.inputTokens.toLocaleString()}
              </InfoRow>
            )}
            {usage.outputTokens !== undefined && (
              <InfoRow label={t('messageInfo.output')}>
                {usage.outputTokens.toLocaleString()}
              </InfoRow>
            )}
            {usage.reasoningTokens !== undefined && (
              <InfoRow label={t('messageInfo.reasoning')}>
                {usage.reasoningTokens.toLocaleString()}
              </InfoRow>
            )}
            {usage.cachedInputTokens !== undefined && (
              <InfoRow label={t('messageInfo.cached')}>
                {usage.cachedInputTokens.toLocaleString()}
              </InfoRow>
            )}
            {usage.totalTokens !== undefined && (
              <InfoRow label={t('messageInfo.total')}>
                {usage.totalTokens.toLocaleString()}
              </InfoRow>
            )}
          </>
        )}

        {hasPerformance && (
          <>
            <SectionLabel>{t('messageInfo.performance')}</SectionLabel>
            {usage.durationMs !== undefined && (
              <InfoRow label={t('messageInfo.duration')}>
                {formatMs(usage.durationMs)}
              </InfoRow>
            )}
            {usage.timeToFirstTokenMs !== undefined && (
              <InfoRow label={t('messageInfo.timeToFirstToken')}>
                {formatMs(usage.timeToFirstTokenMs)}
              </InfoRow>
            )}
            {throughput !== undefined && (
              <InfoRow label={t('messageInfo.throughput')}>
                {t('messageInfo.tokensPerSecond', {
                  value: throughput.toFixed(1),
                })}
              </InfoRow>
            )}
          </>
        )}

        {message.blockedReason !== undefined && (
          <>
            <SectionLabel>{t('messageInfo.blockedReason')}</SectionLabel>
            <Text className="text-sm">{message.blockedReason}</Text>
          </>
        )}
        {message.error !== undefined && (
          <>
            <SectionLabel>{t('messageInfo.error')}</SectionLabel>
            <Text className="text-sm">{message.error}</Text>
          </>
        )}

        {!hasTokens && !hasPerformance && message.model === undefined && (
          <Text variant="muted" className="text-sm">
            {t('messageInfo.noMetadata')}
          </Text>
        )}
      </Stack>
    </Dialog>
  );
}
