'use client';

/**
 * The bound-projects manager for a PROJECT-SCOPED automation, rendered inside
 * its Configuration tab. Which project(s) an automation runs in is
 * configuration, so it lives with the automation's other settings. Each bound
 * project links through and carries its own "Remove from this project" action;
 * a `SearchableSelect` combobox (the same control the other settings pages use)
 * adds a project by binding the already-installed automation to it.
 */
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, VStack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { Link } from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';

import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { notifyOnInstallFailure } from '../hooks/install-failure-toast';
import { useAutomationDisplay } from '../hooks/use-automation-text';
import type { AutomationSummary } from '../hooks/use-automations';
import {
  useAutomationBindings,
  useAutomationInstallActions,
} from '../hooks/use-install-state';
import { AutomationLifecycleActions } from './automation-lifecycle-actions';

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
  const { projects } = useProjects(organizationId);
  const { install } = useAutomationInstallActions(organizationId);

  // Only projects the automation isn't already bound to are addable.
  const boundIds = new Set(bindings.map((b) => b.projectId));
  const available = projects.filter((p) => !boundIds.has(p._id));

  return (
    <VStack gap={3}>
      <SectionHeader as="h3" size="sm" title={t('membership.title')} />
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

      {/* Add a project by selecting it — binds the already-installed automation
          to that project (org-level integrations are already connected). */}
      <SearchableSelect
        label={t('membership.addProject')}
        placeholder={t('install.projectPlaceholder')}
        searchPlaceholder={t('install.projectSearchPlaceholder')}
        emptyText={t('install.noProjects')}
        value={null}
        onValueChange={(projectId) =>
          notifyOnInstallFailure(
            install(automationSlug, projectId),
            t('install.installFailed'),
          )
        }
        options={available.map((p) => ({ value: p._id, label: p.name }))}
      />
    </VStack>
  );
}
