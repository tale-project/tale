'use client';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
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
            <StatGrid
              items={
                [
                  ...(usage.inputTokens !== undefined
                    ? [
                        {
                          label: t('messageInfo.input'),
                          value: (
                            <Text variant="label">
                              {formatNumber(usage.inputTokens, locale)}
                            </Text>
                          ),
                        },
                      ]
                    : []),
                  ...(usage.outputTokens !== undefined
                    ? [
                        {
                          label: t('messageInfo.output'),
                          value: (
                            <Text variant="label">
                              {formatNumber(usage.outputTokens, locale)}
                            </Text>
                          ),
                        },
                      ]
                    : []),
                  {
                    label: t('messageInfo.total'),
                    value: (
                      <Text variant="label">
                        {formatNumber(usage.totalTokens, locale)}
                      </Text>
                    ),
                  },
                  ...(usage.durationMs !== undefined
                    ? [
                        {
                          label: t('messageInfo.duration'),
                          value: (
                            <Text variant="label">
                              {(usage.durationMs / 1000).toFixed(2)}s
                            </Text>
                          ),
                        },
                      ]
                    : []),
                ] satisfies StatGridItem[]
              }
            />
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
