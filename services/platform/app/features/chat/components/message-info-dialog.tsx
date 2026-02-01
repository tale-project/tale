'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack, Grid } from '@/app/components/ui/layout/layout';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { formatDate } from '@/lib/utils/date/format';
import { formatNumber } from '@/lib/utils/format/number';
import { useLocale, useT } from '@/lib/i18n/client';
import type { MessageMetadata } from '../hooks/use-message-metadata';

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

            {metadata.totalTokens !== undefined && (
              <Field label={t('messageInfo.tokenUsage')}>
                <Grid cols={2} gap={2} className="text-sm">
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
                    <div
                      key={`${usage.toolName}-${index}`}
                      className="text-sm bg-muted px-3 py-2 rounded"
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
                        </div>
                      )}
                    </div>
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
    </ViewDialog>
  );
}
