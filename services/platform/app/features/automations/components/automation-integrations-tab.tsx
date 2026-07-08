'use client';

/**
 * The automation detail's "Integrations" tab — the automation's declared
 * integration dependencies as a card grid (the same `IntegrationCard` the
 * settings catalog renders, connection badge included). A not-yet-connected
 * card opens the connect-only install wizard for exactly that integration; a
 * connected one links through to its management surface in Settings.
 */
import { EmptyState } from '@tale/ui/empty-state';
import { useNavigate } from '@tanstack/react-router';
import { Plug } from 'lucide-react';
import { useState } from 'react';

import { CatalogGrid } from '@/app/components/catalog/catalog-grid';
import { IntegrationCard } from '@/app/features/settings/integrations/components/integration-card';
import { useT } from '@/lib/i18n/client';

import { useAutomationDisplay } from '../hooks/use-automation-text';
import type { AutomationSummary } from '../hooks/use-automations';
import { useRequiredIntegrations } from '../hooks/use-required-integrations';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';

export function AutomationIntegrationsTab({
  organizationId,
  automationSlug,
  automation,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
  projectId?: string;
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  const navigate = useNavigate();
  const { required } = useRequiredIntegrations(
    organizationId,
    automation.requiredIntegrations,
  );
  const [connectSlug, setConnectSlug] = useState<string | null>(null);

  if (required.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title={t('integrationsTab.emptyTitle')}
        description={t('integrationsTab.emptyDescription')}
      />
    );
  }

  return (
    <>
      <CatalogGrid>
        {required.map((item) => (
          <IntegrationCard
            key={item.slug}
            title={item.integration.title}
            description={item.integration.description}
            isActive={item.connected}
            iconUrl={item.integration.iconUrl ?? undefined}
            onClick={() => {
              if (item.connected) {
                void navigate({
                  to: '/dashboard/$id/settings/integrations',
                  params: { id: organizationId },
                  search: { slug: item.slug },
                });
                return;
              }
              setConnectSlug(item.slug);
            }}
          />
        ))}
      </CatalogGrid>
      {connectSlug && (
        <AutomationInstallWizard
          open
          onOpenChange={(open) => {
            if (!open) setConnectSlug(null);
          }}
          organizationId={organizationId}
          automationSlug={automationSlug}
          automationName={display.name}
          scope={automation.scope}
          projectId={projectId}
          requiredIntegrations={automation.requiredIntegrations}
          mode="connect-only"
          initialSlugs={[connectSlug]}
        />
      )}
    </>
  );
}
