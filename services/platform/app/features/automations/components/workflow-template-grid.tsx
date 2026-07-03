'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useListWorkflows } from '../hooks/file-queries';
import { getIntegrationBrandIcon } from '../utils/integration-brand-icon';
import { parseWorkflowTemplates } from '../utils/workflow-templates';

interface WorkflowTemplateGridProps {
  organizationId: string;
  integrationName?: string;
  selectedSlug: string | null;
  onSelectSlug: (slug: string) => void;
  installingSlug: string | null;
  /** Free-text filter over template name + description (catalog page only). */
  searchQuery?: string;
  /**
   * Constrain the grid to its own scroll area (the create dialog). The full
   * catalog page passes `false` so the page scrolls instead.
   */
  scrollable?: boolean;
}

/** Media tile showing the primary integration brand icon, stretching to match the text height. */
function TemplateBrandIcon({ integration }: { integration: string }) {
  const Icon = getIntegrationBrandIcon(integration);
  return (
    <div
      className="border-border-base bg-bg-base flex min-h-10 w-10 shrink-0 items-center justify-center self-stretch rounded-lg border"
      aria-label={integration}
    >
      <Icon className="size-5" />
    </div>
  );
}

/** Extra integration chips shown below the card text (when a template has more than one). */
function ExtraBrandChips({ integrations }: { integrations: string[] }) {
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
  selectedSlug,
  onSelectSlug,
  installingSlug,
  searchQuery,
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

  const filteredTemplates = useMemo(() => {
    const templates = parseWorkflowTemplates(workflows, integrationName);
    const q = searchQuery?.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(q) ||
        (template.description ?? '').toLowerCase().includes(q),
    );
  }, [workflows, integrationName, searchQuery]);

  if (isLoadingTemplates) {
    return (
      <Row gap={0} justify="center" className="p-8">
        <Spinner size="sm" label={t('templates.fetching')} />
      </Row>
    );
  }

  if (filteredTemplates.length === 0) {
    return (
      <Text variant="muted">
        {searchQuery?.trim()
          ? t('search.noResults')
          : t('templates.noTemplates')}
      </Text>
    );
  }

  const cards = filteredTemplates.map((template) => (
    <CatalogCard
      key={template.slug}
      media={
        template.integrations[0] ? (
          <TemplateBrandIcon integration={template.integrations[0]} />
        ) : undefined
      }
      title={template.name}
      description={template.description}
      meta={<ExtraBrandChips integrations={template.integrations.slice(1)} />}
      badge={
        installingSlug === template.slug ? (
          <Spinner size="sm" label={t('templates.fetching')} />
        ) : undefined
      }
      active={selectedSlug === template.slug}
      disabled={!!installingSlug || !canInstall}
      ariaLabel={template.name}
      onClick={() => onSelectSlug(template.slug)}
    />
  ));

  return (
    <Stack gap={4}>
      <Text variant="muted">{t('templates.description')}</Text>
      <div aria-busy={!!installingSlug}>
        {scrollable ? (
          <Stack gap={2}>{cards}</Stack>
        ) : (
          <CatalogGrid>{cards}</CatalogGrid>
        )}
      </div>
    </Stack>
  );
}
