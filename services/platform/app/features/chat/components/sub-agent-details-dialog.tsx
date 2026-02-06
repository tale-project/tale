'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack, Grid } from '@/app/components/ui/layout/layout';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { formatNumber } from '@/lib/utils/format/number';
import { useLocale } from '@/app/hooks/use-locale';
import { useT } from '@/lib/i18n/client';
import type { SubAgentUsage } from '../hooks/use-message-metadata';

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

interface SubAgentDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  usage: SubAgentUsage | null;
}

export function SubAgentDetailsDialog({
  isOpen,
  onOpenChange,
  usage,
}: SubAgentDetailsDialogProps) {
  const { locale } = useLocale();
  const { t } = useT('chat');

  if (!usage) return null;

  const agentName = formatAgentName(usage.toolName);

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('subAgentDetails.title', { agent: agentName })}
      className="sm:max-w-[600px] overflow-x-hidden"
    >
      <FieldGroup gap={4}>
        {usage.model && (
          <Field label={t('messageInfo.model')}>
            <div className="text-sm">
              {usage.model}
              {usage.provider && ` (${usage.provider})`}
            </div>
          </Field>
        )}

        {usage.totalTokens !== undefined && (
          <Field label={t('messageInfo.tokenUsage')}>
            <Grid cols={2} gap={2} className="text-sm">
              {usage.inputTokens !== undefined && (
                <Stack gap={0}>
                  <div className="text-xs text-muted-foreground">
                    {t('messageInfo.input')}
                  </div>
                  <div className="font-medium">
                    {formatNumber(usage.inputTokens, locale)}
                  </div>
                </Stack>
              )}
              {usage.outputTokens !== undefined && (
                <Stack gap={0}>
                  <div className="text-xs text-muted-foreground">
                    {t('messageInfo.output')}
                  </div>
                  <div className="font-medium">
                    {formatNumber(usage.outputTokens, locale)}
                  </div>
                </Stack>
              )}
              <Stack gap={0}>
                <div className="text-xs text-muted-foreground">
                  {t('messageInfo.total')}
                </div>
                <div className="font-medium">
                  {formatNumber(usage.totalTokens, locale)}
                </div>
              </Stack>
              {usage.durationMs !== undefined && (
                <Stack gap={0}>
                  <div className="text-xs text-muted-foreground">
                    {t('messageInfo.duration')}
                  </div>
                  <div className="font-medium">
                    {(usage.durationMs / 1000).toFixed(2)}s
                  </div>
                </Stack>
              )}
            </Grid>
          </Field>
        )}

        {usage.input && (
          <Field label={t('subAgentDetails.input')}>
            <div className="text-sm bg-muted px-3 py-2 rounded max-h-40 overflow-y-auto break-all">
              {usage.input}
            </div>
          </Field>
        )}

        {usage.output && (
          <Field label={t('subAgentDetails.output')}>
            <div className="text-sm bg-muted px-3 py-2 rounded max-h-60 overflow-y-auto break-all">
              {usage.output}
            </div>
          </Field>
        )}
      </FieldGroup>
    </ViewDialog>
  );
}
