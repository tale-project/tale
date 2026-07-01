'use client';

import { Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
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
  const [searchQuery, setSearchQuery] = useState('');

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
