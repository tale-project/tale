'use client';

/**
 * One bundled view of a project-bound automation, rendered as a first-class
 * PROJECT tab (`/projects/$projectId/views/$automationSlug/$viewId`) — the
 * operator surface. Access follows project membership: the tab only exists
 * inside the project shell, and every bound query is project-scoped. The
 * automation's own page keeps the admin tabs (Configuration, Integrations,
 * Editor …); project-scoped view tabs no longer render there.
 */
import { EmptyState } from '@tale/ui/empty-state';
import { SkeletonText } from '@tale/ui/skeleton';
import { LayoutGrid } from 'lucide-react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useProject } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  isAutomationViewErrorStub,
  useAutomations,
} from '../hooks/use-automations';
import { useAutomationBindings } from '../hooks/use-install-state';
import { useOpenTimeIntegrityCheck } from '../hooks/use-open-time-integrity-check';
import { useReinstallWithPreflight } from '../hooks/use-reinstall-with-preflight';
import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { ResourceDetailProvider } from '../runtime/resource-detail';
import {
  AutomationViewBody,
  ViewErrorStubAlert,
  viewRouteId,
} from './automation-view-body';

export function ProjectAutomationViewPage({
  organizationId,
  projectId,
  automationSlug,
  viewId,
}: {
  organizationId: string;
  projectId: string;
  automationSlug: string;
  viewId: string;
}) {
  const { t } = useT('automations');
  const { automations, isLoading } = useAutomations(organizationId);
  const { bindings, isLoading: bindingsLoading } = useAutomationBindings(
    organizationId,
    automationSlug,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route param is the bound project's Convex id
  const { project } = useProject(projectId as Id<'projects'>);
  useOpenTimeIntegrityCheck(organizationId, automationSlug);
  const {
    requestReinstall,
    dialog: reinstallDialog,
    isPending,
  } = useReinstallWithPreflight(organizationId);

  if (isLoading || bindingsLoading) {
    return (
      <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
        <SkeletonText lines={6} />
      </ContentArea>
    );
  }

  const automation = automations.find((a) => a.slug === automationSlug);
  const boundHere = bindings.some((b) => b.projectId === projectId);
  const view = automation?.views.find(
    (v, index) => viewRouteId(v, index) === viewId,
  );

  // One honest empty state for every unreachable case — uninstalled
  // automation, automation not bound to THIS project, or a view id the
  // bundle no longer ships.
  if (!automation || !boundHere || view === undefined) {
    return (
      <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
        <EmptyState
          icon={LayoutGrid}
          title={t('viewNotFound.title')}
          description={t('viewNotFound.description')}
        />
      </ContentArea>
    );
  }

  if (isAutomationViewErrorStub(view)) {
    return (
      <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
        {reinstallDialog}
        <ViewErrorStubAlert
          message={view.error.message}
          onReinstall={() => void requestReinstall(automationSlug)}
          isPending={isPending}
        />
      </ContentArea>
    );
  }

  return (
    <AutomationRuntimeProvider
      value={{
        organizationId,
        projectId,
        ...(typeof project?.name === 'string' && project.name !== ''
          ? { projectName: project.name }
          : {}),
        automationSlug,
        allowlist: automation.functions,
      }}
    >
      <ResourceDetailProvider>
        <ContentArea gap={6} className="mx-auto max-w-3xl px-4 py-4">
          <AutomationViewBody view={view} />
        </ContentArea>
      </ResourceDetailProvider>
    </AutomationRuntimeProvider>
  );
}
