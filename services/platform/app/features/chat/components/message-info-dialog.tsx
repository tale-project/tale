'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack, Grid } from '@/app/components/ui/layout/layout';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { useCopyButton } from '@/app/hooks/use-copy';
import { formatDate } from '@/lib/utils/date/format';
import { formatNumber } from '@/lib/utils/format/number';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageMetadata, SubAgentUsage } from '../hooks/use-message-metadata';
import { SubAgentDetailsDialog } from './sub-agent-details-dialog';

function formatAgentName(toolName: string): string {
  const nameMap: Record<string, string> = {
    web_assistant: 'Web',
    document_assistant: 'Document',
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
      <Stack gap={0}>
        <div className="text-xs text-muted-foreground">
          {t('messageInfo.contextWindow')}
        </div>
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="font-medium text-left cursor-pointer hover:underline"
        >
          {formatNumber(tokenCount, locale)}
        </button>
      </Stack>

      <ViewDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={t('messageInfo.contextWindow')}
        description={t('messageInfo.contextWindowDescription')}
        className="sm:max-w-[800px] max-h-[80vh]"
        headerActions={
          <IconButton
            icon={copied ? Check : Copy}
            aria-label={copied ? tCommon('actions.copied') : tCommon('actions.copy')}
            onClick={handleCopy}
          />
        }
      >
        <div className="context-window-content overflow-auto max-h-[60vh] [&_details]:border [&_details]:border-border [&_details]:rounded-md [&_details]:mb-2 [&_details]:overflow-hidden [&_details_summary]:px-3 [&_details_summary]:py-2 [&_details_summary]:cursor-pointer [&_details_summary]:font-medium [&_details_summary]:bg-muted [&_details_summary]:list-none [&_details[open]_summary]:border-b [&_details[open]_summary]:border-border [&_details>*:not(summary)]:p-3 [&_details>*:not(summary)]:font-mono [&_details>*:not(summary)]:text-xs [&_details>*:not(summary)]:whitespace-pre-wrap [&_details>*:not(summary)]:overflow-x-auto">
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
  const locale = useLocale();
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const [selectedSubAgent, setSelectedSubAgent] = useState<SubAgentUsage | null>(null);

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
          <div className="text-sm">{formatDate(timestamp, { preset: 'long' })}</div>
        </Field>

        <Field label={t('messageInfo.messageId')}>
          <div className="text-xs font-mono bg-muted px-2 py-1 rounded">
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
                  {metadata.inputTokens !== undefined && (
                    <Stack gap={0}>
                      <div className="text-xs text-muted-foreground">
                        {t('messageInfo.input')}
                      </div>
                      <div className="font-medium">
                        {formatNumber(metadata.inputTokens, locale)}
                      </div>
                    </Stack>
                  )}
                  {metadata.outputTokens !== undefined && (
                    <Stack gap={0}>
                      <div className="text-xs text-muted-foreground">
                        {t('messageInfo.output')}
                      </div>
                      <div className="font-medium">
                        {formatNumber(metadata.outputTokens, locale)}
                      </div>
                    </Stack>
                  )}
                  {metadata.totalTokens !== undefined && (
                    <Stack gap={0}>
                      <div className="text-xs text-muted-foreground">
                        {t('messageInfo.total')}
                      </div>
                      <div className="font-medium">
                        {formatNumber(metadata.totalTokens, locale)}
                      </div>
                    </Stack>
                  )}
                  {metadata.reasoningTokens !== undefined &&
                    metadata.reasoningTokens > 0 && (
                      <Stack gap={0}>
                        <div className="text-xs text-muted-foreground">
                          {t('messageInfo.reasoning')}
                        </div>
                        <div className="font-medium">
                          {formatNumber(metadata.reasoningTokens, locale)}
                        </div>
                      </Stack>
                    )}
                  {metadata.cachedInputTokens !== undefined &&
                    metadata.cachedInputTokens > 0 && (
                      <Stack gap={0}>
                        <div className="text-xs text-muted-foreground">
                          {t('messageInfo.cached')}
                        </div>
                        <div className="font-medium">
                          {formatNumber(metadata.cachedInputTokens, locale)}
                        </div>
                      </Stack>
                    )}
                </Grid>
              </Field>
            )}

            {(metadata.durationMs !== undefined || metadata.timeToFirstTokenMs !== undefined) && (
              <Field label={t('messageInfo.performance')}>
                <Grid cols={2} gap={2} className="text-sm">
                  {metadata.durationMs !== undefined && (
                    <Stack gap={0}>
                      <div className="text-xs text-muted-foreground">
                        {t('messageInfo.duration')}
                      </div>
                      <div className="font-medium">
                        {(metadata.durationMs / 1000).toFixed(2)}s
                      </div>
                    </Stack>
                  )}
                  {metadata.timeToFirstTokenMs !== undefined && (
                    <Stack gap={0}>
                      <div className="text-xs text-muted-foreground">
                        {t('messageInfo.timeToFirstToken')}
                      </div>
                      <div className="font-medium">
                        {(metadata.timeToFirstTokenMs / 1000).toFixed(2)}s
                      </div>
                    </Stack>
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
                      className="text-sm bg-muted px-3 py-2 rounded text-left cursor-pointer hover:bg-muted/80 transition-colors"
                    >
                      <div className="font-medium mb-1">
                        {formatAgentName(usage.toolName)}
                        {usage.model && (
                          <span className="font-normal text-muted-foreground ml-2">
                            {usage.model}
                            {usage.provider && ` (${usage.provider})`}
                          </span>
                        )}
                      </div>
                      {usage.totalTokens !== undefined && (
                        <div className="text-xs text-muted-foreground">
                          {t('messageInfo.input')}: {formatNumber(usage.inputTokens ?? 0, locale)}
                          {' · '}
                          {t('messageInfo.output')}: {formatNumber(usage.outputTokens ?? 0, locale)}
                          {' · '}
                          {t('messageInfo.total')}: {formatNumber(usage.totalTokens, locale)}
                          {usage.durationMs !== undefined && (
                            <>
                              {' · '}
                              {t('messageInfo.duration')}: {(usage.durationMs / 1000).toFixed(2)}s
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
                <div className="text-sm bg-muted px-3 py-2 rounded max-h-40 overflow-y-auto">
                  {metadata.reasoning}
                </div>
              </Field>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
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
