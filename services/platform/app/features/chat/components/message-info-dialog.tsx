'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { Stack, Grid } from '@/app/components/ui/layout/layout';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import type { MessageMetadata, SubAgentUsage } from '../hooks/queries';

import { SubAgentDetailsDialog } from './sub-agent-details-dialog';

function formatAgentName(toolName: string): string {
  const nameMap: Record<string, string> = {
    document_assistant: 'Document',
    crm_assistant: 'CRM',
    integration_assistant: 'Integration',
    workflow_assistant: 'Workflow',
  };
  return nameMap[toolName] ?? toolName;
}

interface StatItemProps {
  label: string;
  value: string | number;
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <Stack gap={0}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium">{value}</div>
    </Stack>
  );
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
      <Stack gap={0}>
        <div className="text-muted-foreground text-xs">
          {t('messageInfo.contextWindow')}
        </div>
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="cursor-pointer text-left font-medium hover:underline"
        >
          ~{formatNumber(tokenCount, locale)}
        </button>
      </Stack>

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

interface MessageInfoDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export function MessageInfoDialog({
  isOpen,
  onOpenChange,
  messageId,
  timestamp,
  metadata,
}: MessageInfoDialogProps) {
  const { formatDate, locale } = useFormatDate();
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const [selectedSubAgent, setSelectedSubAgent] =
    useState<SubAgentUsage | null>(null);

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('messageInfo.title')}
      description={t('messageInfo.description')}
      className="sm:max-w-[500px]"
    >
      <FieldGroup gap={4}>
        <Field label={t('messageInfo.timestamp')}>
          <div className="text-sm">{formatDate(timestamp, 'long')}</div>
        </Field>

        <Field label={t('messageInfo.messageId')}>
          <div className="bg-muted rounded px-2 py-1 font-mono text-xs">
            {messageId}
          </div>
        </Field>

        {metadata ? (
          <>
            <Field label={t('messageInfo.model')}>
              <div className="text-sm">
                {metadata.model} ({metadata.provider})
              </div>
            </Field>

            {(metadata.contextWindow ||
              metadata.totalTokens !== undefined ||
              metadata.inputTokens !== undefined ||
              metadata.outputTokens !== undefined ||
              (metadata.reasoningTokens ?? 0) > 0 ||
              (metadata.cachedInputTokens ?? 0) > 0) && (
              <Field label={t('messageInfo.tokenUsage')}>
                <Grid cols={2} gap={2} className="text-sm">
                  {metadata.contextWindow && (
                    <ContextWindowToken
                      contextWindow={metadata.contextWindow}
                      contextStats={metadata.contextStats}
                      t={t}
                      tCommon={tCommon}
                      locale={locale}
                    />
                  )}
                  {(
                    [
                      [metadata.inputTokens, 'input'],
                      [metadata.outputTokens, 'output'],
                      [metadata.totalTokens, 'total'],
                      [metadata.reasoningTokens, 'reasoning'],
                      [metadata.cachedInputTokens, 'cached'],
                    ] as const
                  ).map(
                    ([value, key]) =>
                      value != null &&
                      value > 0 && (
                        <StatItem
                          key={key}
                          label={t(`messageInfo.${key}`)}
                          value={formatNumber(value, locale)}
                        />
                      ),
                  )}
                </Grid>
              </Field>
            )}

            {(metadata.durationMs !== undefined ||
              metadata.timeToFirstTokenMs !== undefined) && (
              <Field label={t('messageInfo.performance')}>
                <Grid cols={2} gap={2} className="text-sm">
                  {(
                    [
                      [metadata.durationMs, 'duration'],
                      [metadata.timeToFirstTokenMs, 'timeToFirstToken'],
                    ] as const
                  ).map(
                    ([value, key]) =>
                      value != null && (
                        <StatItem
                          key={key}
                          label={t(`messageInfo.${key}`)}
                          value={`${(value / 1000).toFixed(2)}s`}
                        />
                      ),
                  )}
                </Grid>
              </Field>
            )}

            {metadata.subAgentUsage && metadata.subAgentUsage.length > 0 && (
              <Field label={t('messageInfo.subAgentCalls')}>
                <Stack gap={2}>
                  {metadata.subAgentUsage.map((usage, index) => (
                    <button
                      key={`${usage.toolName}-${index}`}
                      type="button"
                      onClick={() => setSelectedSubAgent(usage)}
                      className="bg-muted hover:bg-muted/80 cursor-pointer rounded px-3 py-2 text-left text-sm transition-colors"
                    >
                      <div className="mb-1 font-medium">
                        {formatAgentName(usage.toolName)}
                        {usage.model && (
                          <span className="text-muted-foreground ml-2 font-normal">
                            {usage.model}
                            {usage.provider && ` (${usage.provider})`}
                          </span>
                        )}
                      </div>
                      {usage.totalTokens !== undefined && (
                        <div className="text-muted-foreground text-xs">
                          {t('messageInfo.input')}:{' '}
                          {formatNumber(usage.inputTokens ?? 0, locale)}
                          {' · '}
                          {t('messageInfo.output')}:{' '}
                          {formatNumber(usage.outputTokens ?? 0, locale)}
                          {' · '}
                          {t('messageInfo.total')}:{' '}
                          {formatNumber(usage.totalTokens, locale)}
                          {usage.durationMs !== undefined && (
                            <>
                              {' · '}
                              {t('messageInfo.duration')}:{' '}
                              {(usage.durationMs / 1000).toFixed(2)}s
                            </>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </Stack>
              </Field>
            )}

            {metadata.reasoning && (
              <Field label={t('messageInfo.reasoning')}>
                <div className="bg-muted max-h-40 overflow-y-auto rounded px-3 py-2 text-sm">
                  {metadata.reasoning}
                </div>
              </Field>
            )}
          </>
        ) : (
          <div className="text-muted-foreground text-sm">
            {t('messageInfo.noMetadata')}
          </div>
        )}
      </FieldGroup>

      <SubAgentDetailsDialog
        isOpen={selectedSubAgent !== null}
        onOpenChange={(open) => !open && setSelectedSubAgent(null)}
        usage={selectedSubAgent}
      />
    </ViewDialog>
  );
}
