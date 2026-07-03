'use client';

import { Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  useInstallWorkflow,
  useInvalidateWorkflows,
} from '../hooks/file-mutations';
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
  const { mutateAsync: installWorkflow } = useInstallWorkflow();
  const invalidateWorkflows = useInvalidateWorkflows();
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // The catalog is a full-page browse surface — single-click installs
  // immediately (no selection step needed outside a confined dialog).
  const handleSelectSlug = useCallback(
    async (slug: string) => {
      setInstallingSlug(slug);
      try {
        await installWorkflow({ organizationId, workflowSlug: slug });
        await invalidateWorkflows(organizationId);
        window.dispatchEvent(new Event('workflow-updated'));
        toast({ title: t('catalog.installed'), variant: 'success' });
        void navigate({
          to: '/dashboard/$id/automations',
          params: { id: organizationId },
        });
      } catch {
        toast({ title: t('toast.createFailed'), variant: 'destructive' });
      } finally {
        setInstallingSlug(null);
      }
    },
    [installWorkflow, invalidateWorkflows, organizationId, t, navigate],
  );

  return (
    <Stack gap={6} className="p-6">
      <SearchInput
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t('search.placeholder')}
        className="w-64 shrink-0"
      />
      <WorkflowTemplateGrid
        organizationId={organizationId}
        searchQuery={searchQuery}
        scrollable={false}
        selectedSlug={null}
        onSelectSlug={(slug) => void handleSelectSlug(slug)}
        installingSlug={installingSlug}
      />
    </Stack>
  );
}
