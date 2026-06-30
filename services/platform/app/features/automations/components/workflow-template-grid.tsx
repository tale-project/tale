'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { AlertCircle } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';

import {
  CatalogCard,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import {
  useInstallWorkflow,
  useInvalidateWorkflows,
} from '../hooks/file-mutations';
import { useListWorkflows } from '../hooks/file-queries';
import { getIntegrationBrandIcon } from '../utils/integration-brand-icon';
import { parseWorkflowTemplates } from '../utils/workflow-templates';

interface WorkflowTemplateGridProps {
  organizationId: string;
  integrationName?: string;
  onTemplateInstalled: (slug: string) => void;
  /**
   * Constrain the grid to its own scroll area (the create dialog). The full
   * catalog page passes `false` so the page scrolls instead.
   */
  scrollable?: boolean;
}

/** Small bordered brand chip row shown as a card's meta (one per integration). */
function TemplateBrandChips({ integrations }: { integrations: string[] }) {
  if (integrations.length === 0) return null;
  return (
    <>
      {integrations.map((integration) => {
        const Icon = getIntegrationBrandIcon(integration);
        return (
          <Row
            key={integration}
            gap={0}
            justify="center"
            className="border-border bg-background text-foreground size-5 rounded border p-1"
            aria-label={integration}
          >
            <Icon className="size-3" />
          </Row>
        );
      })}
    </>
  );
}

export function WorkflowTemplateGrid({
  organizationId,
  integrationName,
  onTemplateInstalled,
  scrollable = true,
}: WorkflowTemplateGridProps) {
  const { t } = useT('automations');
  // Installing a template creates a workflow — a write action. Read-only roles
  // (member/editor) can browse the catalog but not install (#2076).
  const ability = useAbility();
  const canInstall = ability.can('write', 'wfDefinitions');
  const { workflows, isLoading: isLoadingTemplates } = useListWorkflows(
    organizationId,
    'templates',
  );
  const { mutateAsync: installWorkflow } = useInstallWorkflow();
  const invalidateWorkflows = useInvalidateWorkflows();
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredTemplates = useMemo(
    () => parseWorkflowTemplates(workflows, integrationName),
    [workflows, integrationName],
  );

  const handleSelectTemplate = useCallback(
    async (slug: string) => {
      if (!canInstall) return;
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
      canInstall,
      installWorkflow,
      invalidateWorkflows,
      onTemplateInstalled,
      organizationId,
      t,
    ],
  );

  if (isLoadingTemplates) {
    return (
      <Row gap={0} justify="center" className="p-8">
        <Spinner size="sm" label={t('templates.fetching')} />
      </Row>
    );
  }

  if (filteredTemplates.length === 0) {
    return <Text variant="muted">{t('templates.noTemplates')}</Text>;
  }

  return (
    <Stack gap={4}>
      <Text variant="muted">{t('templates.description')}</Text>

      {error && (
        <Row
          gap={2}
          align="start"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </Row>
      )}

      <div
        className={scrollable ? 'max-h-96 overflow-y-auto' : undefined}
        aria-busy={!!installingSlug}
      >
        <CatalogGrid>
          {filteredTemplates.map((template) => (
            <CatalogCard
              key={template.slug}
              title={template.name}
              description={template.description}
              meta={<TemplateBrandChips integrations={template.integrations} />}
              badge={
                installingSlug === template.slug ? (
                  <Spinner size="sm" label={t('templates.fetching')} />
                ) : undefined
              }
              active={installingSlug === template.slug}
              disabled={!!installingSlug || !canInstall}
              ariaLabel={template.name}
              onClick={() => void handleSelectTemplate(template.slug)}
            />
          ))}
        </CatalogGrid>
      </div>
    </Stack>
  );
}
