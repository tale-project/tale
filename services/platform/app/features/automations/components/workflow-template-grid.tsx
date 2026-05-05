'use client';

import { Spinner } from '@tale/ui/spinner';
import { AlertCircle } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useInstallWorkflow,
  useInvalidateWorkflows,
} from '../hooks/file-mutations';
import { useListWorkflows } from '../hooks/file-queries';

interface WorkflowTemplateGridProps {
  organizationId: string;
  integrationName?: string;
  onTemplateInstalled: (slug: string) => void;
}

export function WorkflowTemplateGrid({
  organizationId,
  integrationName,
  onTemplateInstalled,
}: WorkflowTemplateGridProps) {
  const { t } = useT('automations');
  const { workflows, isLoading: isLoadingTemplates } = useListWorkflows(
    organizationId,
    'templates',
  );
  const { mutateAsync: installWorkflow } = useInstallWorkflow();
  const invalidateWorkflows = useInvalidateWorkflows();
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    if (!workflows) return [];
    const valid: { slug: string; name: string; description?: string }[] = [];
    for (const w of workflows) {
      if (
        w &&
        typeof w === 'object' &&
        'slug' in w &&
        'name' in w &&
        typeof w.slug === 'string' &&
        typeof w.name === 'string'
      ) {
        valid.push({
          slug: w.slug,
          name: w.name,
          description:
            'description' in w && typeof w.description === 'string'
              ? w.description
              : undefined,
        });
      }
    }
    if (!integrationName) return valid;
    return valid.filter((w) => {
      const category = w.slug.includes('/') ? w.slug.split('/')[0] : '';
      return (
        category === integrationName || category === 'general' || !category
      );
    });
  }, [workflows, integrationName]);

  const handleSelectTemplate = useCallback(
    async (slug: string) => {
      setError(null);
      setInstallingSlug(slug);

      try {
        await installWorkflow({
          organizationId,
          workflowSlug: slug,
        });
        await invalidateWorkflows(organizationId);
        window.dispatchEvent(new Event('workflow-updated'));
        onTemplateInstalled(slug);
      } catch (err) {
        console.error('[template install]', err);
        const detail =
          err instanceof Error ? err.message.split('\n')[0] : String(err);
        setError(`${t('templates.installFailed')}: ${detail}`);
      } finally {
        setInstallingSlug(null);
      }
    },
    [
      installWorkflow,
      invalidateWorkflows,
      onTemplateInstalled,
      organizationId,
      t,
    ],
  );

  if (isLoadingTemplates) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="sm" label={t('templates.fetching')} />
      </div>
    );
  }

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
        aria-busy={!!installingSlug}
      >
        {filteredTemplates.map((template) => (
          <button
            key={template.slug}
            type="button"
            onClick={() => handleSelectTemplate(template.slug)}
            disabled={!!installingSlug}
            className={cn(
              'border-border hover:border-primary/50 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              installingSlug === template.slug && 'border-primary/50',
              installingSlug &&
                installingSlug !== template.slug &&
                'opacity-50',
            )}
            aria-label={template.name}
          >
            <Stack gap={1} className="min-w-0 flex-1">
              <Text variant="label" className="truncate">
                {template.name}
              </Text>
              {template.description && (
                <Text variant="caption" className="line-clamp-2">
                  {template.description}
                </Text>
              )}
            </Stack>
            {installingSlug === template.slug && (
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
