'use client';

import { Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { useNavigate } from '@tanstack/react-router';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { WorkflowTemplateGrid } from './workflow-template-grid';

interface AutomationsCatalogProps {
  organizationId: string;
}

/**
 * Automations Catalog tab — browse and install ready-made automation templates
 * as a full-page card grid (the same `CatalogCard` grid the integrations and
 * agents catalogs use). The compact picker inside the create dialog reuses the
 * same `WorkflowTemplateGrid`; here it runs unconstrained (`scrollable={false}`)
 * and lands the user on the automations list after an install.
 */
export function AutomationsCatalog({
  organizationId,
}: AutomationsCatalogProps) {
  const { t } = useT('automations');
  const navigate = useNavigate();

  return (
    <Stack gap={6} className="p-6">
      <SectionHeader
        title={t('catalog.title')}
        description={t('catalog.subtitle')}
      />
      <WorkflowTemplateGrid
        organizationId={organizationId}
        scrollable={false}
        onTemplateInstalled={() => {
          toast({ title: t('catalog.installed'), variant: 'success' });
          void navigate({
            to: '/dashboard/$id/automations',
            params: { id: organizationId },
          });
        }}
      />
    </Stack>
  );
}
