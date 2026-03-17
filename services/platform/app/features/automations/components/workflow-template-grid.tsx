'use client';

import { AlertCircle } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { WorkflowTemplate } from '../constants/workflow-templates';
import type { WorkflowTemplateData } from '../utils/fetch-workflow-template';

import { WORKFLOW_TEMPLATES } from '../constants/workflow-templates';
import { fetchWorkflowTemplate } from '../utils/fetch-workflow-template';

interface WorkflowTemplateGridProps {
  integrationName?: string;
  onTemplateSelected: (data: WorkflowTemplateData) => void | Promise<void>;
}

export function WorkflowTemplateGrid({
  integrationName,
  onTemplateSelected,
}: WorkflowTemplateGridProps) {
  const { t } = useT('automations');
  const [fetchingTemplate, setFetchingTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    if (!integrationName) return WORKFLOW_TEMPLATES;
    return WORKFLOW_TEMPLATES.filter(
      (tpl) =>
        tpl.integrationName === integrationName || tpl.integrationName === '',
    );
  }, [integrationName]);

  const handleSelectTemplate = useCallback(
    async (template: WorkflowTemplate) => {
      setError(null);
      setFetchingTemplate(template.path);

      try {
        const result = await fetchWorkflowTemplate(template);
        if (result.success && result.data) {
          await onTemplateSelected(result.data);
        } else {
          setError(result.error ?? t('templates.fetchError'));
        }
      } catch {
        setError(t('templates.fetchError'));
      } finally {
        setFetchingTemplate(null);
      }
    },
    [onTemplateSelected, t],
  );

  if (filteredTemplates.length === 0) {
    return <Text variant="muted">{t('templates.noTemplates')}</Text>;
  }

  return (
    <Stack gap={4}>
      <Text variant="muted">{t('templates.description')}</Text>

      {error && (
        <div
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        className="grid max-h-80 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2"
        aria-busy={!!fetchingTemplate}
      >
        {filteredTemplates.map((template) => (
          <button
            key={template.path}
            type="button"
            onClick={() => handleSelectTemplate(template)}
            disabled={!!fetchingTemplate}
            className={cn(
              'border-border hover:border-primary/50 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              fetchingTemplate === template.path && 'border-primary/50',
              fetchingTemplate &&
                fetchingTemplate !== template.path &&
                'opacity-50',
            )}
            aria-label={template.title}
          >
            <Stack gap={1} className="min-w-0 flex-1">
              <Text variant="label" className="truncate">
                {template.title}
              </Text>
              <Text variant="caption" className="line-clamp-2">
                {template.description}
              </Text>
            </Stack>
            {fetchingTemplate === template.path && (
              <Spinner
                size="sm"
                label={t('templates.fetching')}
                className="mt-0.5 shrink-0"
              />
            )}
          </button>
        ))}
      </div>
    </Stack>
  );
}
