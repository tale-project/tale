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
import { getIntegrationBrandIcon } from '../utils/integration-brand-icon';

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
    const valid: {
      slug: string;
      name: string;
      description?: string;
      integrations: string[];
    }[] = [];
    for (const w of workflows) {
      if (
        w &&
        typeof w === 'object' &&
        'slug' in w &&
        'name' in w &&
        typeof w.slug === 'string' &&
        typeof w.name === 'string'
      ) {
        const rawIntegrations: unknown =
          'integrations' in w ? w.integrations : undefined;
        const filtered = Array.isArray(rawIntegrations)
          ? rawIntegrations.filter((v): v is string => typeof v === 'string')
          : [];
        // Inbuilt templates with no third-party integration: show the Tale
        // logo so the card still gets a brand chip.
        const integrations = filtered.length > 0 ? filtered : ['tale'];
        valid.push({
          slug: w.slug,
          name: w.name,
          description:
            'description' in w && typeof w.description === 'string'
              ? w.description
              : undefined,
          integrations,
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
        className="flex max-h-80 flex-col gap-2.5 overflow-y-auto"
        aria-busy={!!installingSlug}
      >
        {filteredTemplates.map((template) => (
          <button
            key={template.slug}
            type="button"
            onClick={() => handleSelectTemplate(template.slug)}
            disabled={!!installingSlug}
            className={cn(
              'border-border hover:border-primary/50 bg-background flex w-full items-start gap-3 rounded-lg border p-2 text-left transition-colors',
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
            {template.integrations.length > 0 && (
              <div className="flex shrink-0 items-center gap-1">
                {template.integrations.map((integration) => {
                  const Icon = getIntegrationBrandIcon(integration);
                  return (
                    <div
                      key={integration}
                      className="border-border bg-background text-foreground flex size-5 items-center justify-center rounded border p-1"
                      aria-label={integration}
                    >
                      <Icon className="size-3" />
                    </div>
                  );
                })}
              </div>
            )}
            {installingSlug === template.slug && (
              <Spinner
                size="sm"
                label={t('templates.fetching')}
                className="shrink-0"
              />
            )}
          </button>
        ))}
      </div>
    </Stack>
  );
}
