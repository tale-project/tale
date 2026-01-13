'use client';

import { ViewDialog } from '@/components/ui/dialog/view-dialog';
import { Stack, Grid } from '@/components/ui/layout/layout';
import { Field, FieldGroup } from '@/components/ui/forms/field';
import { formatDate } from '@/lib/utils/date/format';
import { formatNumber } from '@/lib/utils/format/number';
import { useLocale, useT } from '@/lib/i18n/client';

interface MessageMetadata {
  model: string;
  provider: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  reasoning?: string;
  durationMs?: number;
  timeToFirstTokenMs?: number;
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
