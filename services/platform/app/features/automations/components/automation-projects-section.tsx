'use client';

/**
 * The bound-projects manager for a PROJECT-SCOPED automation, rendered inside
 * its Configuration tab.
 *
 * It replaces the standalone "membership hub" page the org route used to show
 * INSTEAD of the automation's own tabs: which project(s) an automation runs in
 * is configuration, so it belongs with the rest of the automation's settings
 * rather than on a page of its own. Each bound project links through to the
 * project-scoped automation page and carries its own "Remove from this project"
 * action; "Add to a project" opens the shared install wizard's project step.
 */
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationDisplay } from '../hooks/use-automation-text';
import type { AutomationSummary } from '../hooks/use-automations';
import { useAutomationBindings } from '../hooks/use-install-state';
import { AutomationLifecycleActions } from './automation-lifecycle-actions';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';

export function AutomationProjectsSection({
  organizationId,
  automationSlug,
  automation,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
}) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  const { bindings } = useAutomationBindings(organizationId, automationSlug);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <VStack gap={3}>
      <HStack className="items-center justify-between">
        <Text className="font-medium">{t('membership.title')}</Text>
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          onClick={() => setWizardOpen(true)}
        >
          {t('membership.addProject')}
        </Button>
      </HStack>
      {bindings.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={t('membership.emptyTitle')}
          description={t('membership.emptyDescription')}
        />
      ) : (
        <VStack gap={2}>
          {bindings.map((binding) => (
            <Card key={binding.projectId} className="py-3">
              <HStack className="items-center justify-between gap-3">
                <Link
                  to="/dashboard/$id/projects/$projectId/automations/$automationSlug"
                  params={{
                    id: organizationId,
                    projectId: binding.projectId,
                    automationSlug,
                  }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {binding.projectName}
                </Link>
                <AutomationLifecycleActions
                  automationSlug={automationSlug}
                  automationName={display.name}
                  organizationId={organizationId}
                  context="project"
                  projectId={binding.projectId}
                />
              </HStack>
            </Card>
          ))}
        </VStack>
      )}

      <AutomationInstallWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        organizationId={organizationId}
        automationSlug={automationSlug}
        automationName={display.name}
        scope={automation.scope}
        requiredIntegrations={automation.requiredIntegrations}
      />
    </VStack>
  );
}
