'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { Stack, Grid } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useLocale } from '@/app/hooks/use-locale';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import type { SubAgentUsage } from '../hooks/queries';

function formatAgentName(toolName: string): string {
  const nameMap: Record<string, string> = {
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
      className="overflow-x-hidden sm:max-w-[600px]"
    >
      <FieldGroup gap={4}>
        {usage.model && (
          <Field label={t('messageInfo.model')}>
            <Text as="div">
              {usage.model}
              {usage.provider && ` (${usage.provider})`}
            </Text>
          </Field>
        )}

        {usage.totalTokens !== undefined && (
          <Field label={t('messageInfo.tokenUsage')}>
            <Grid cols={2} gap={2}>
              {usage.inputTokens !== undefined && (
                <Stack gap={0}>
                  <Text as="div" variant="caption">
                    {t('messageInfo.input')}
                  </Text>
                  <Text as="div" variant="label">
                    {formatNumber(usage.inputTokens, locale)}
                  </Text>
                </Stack>
              )}
              {usage.outputTokens !== undefined && (
                <Stack gap={0}>
                  <Text as="div" variant="caption">
                    {t('messageInfo.output')}
                  </Text>
                  <Text as="div" variant="label">
                    {formatNumber(usage.outputTokens, locale)}
                  </Text>
                </Stack>
              )}
              <Stack gap={0}>
                <Text as="div" variant="caption">
                  {t('messageInfo.total')}
                </Text>
                <Text as="div" variant="label">
                  {formatNumber(usage.totalTokens, locale)}
                </Text>
              </Stack>
              {usage.durationMs !== undefined && (
                <Stack gap={0}>
                  <Text as="div" variant="caption">
                    {t('messageInfo.duration')}
                  </Text>
                  <Text as="div" variant="label">
                    {(usage.durationMs / 1000).toFixed(2)}s
                  </Text>
                </Stack>
              )}
            </Grid>
          </Field>
        )}

        {usage.input && (
          <Field label={t('subAgentDetails.input')}>
            <div className="bg-muted max-h-40 overflow-y-auto rounded px-3 py-2 text-sm break-all">
              {usage.input}
            </div>
          </Field>
        )}

        {usage.output && (
          <Field label={t('subAgentDetails.output')}>
            <div className="bg-muted max-h-60 overflow-y-auto rounded px-3 py-2 text-sm break-all">
              {usage.output}
            </div>
          </Field>
        )}
      </FieldGroup>
    </ViewDialog>
  );
}
