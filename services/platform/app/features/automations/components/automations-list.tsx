'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { SectionHeader } from '@tale/ui/section-header';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link } from '@tanstack/react-router';
import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  FolderKanban,
  Plus,
  Workflow,
} from 'lucide-react';
import { useId, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useAutomations } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import { NewAutomationDialog } from './new-automation-dialog';
import { UploadAutomationDialog } from './upload-automation-dialog';

function ListLoading() {
  return (
    <Skeletonize loading>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
      <SkeletonBox fullWidth>
        <div className="h-14 w-full rounded-md" />
      </SkeletonBox>
    </Skeletonize>
  );
}

/**
 * The organization's automations.
 *
 * Each row answers the only two questions the list can: how many versions exist,
 * and which one — if any — is live. An automation with versions but no
 * deployment is drafts only; saying so here is what stops someone waiting for a
 * schedule that was never promoted.
 */
export function AutomationsList({
  organizationId,
  projectId,
}: {
  organizationId: string;
  /** Render one project's automations (links stay inside the project shell). */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const headingId = useId();
  const ability = useAbility();
  // Which create lane's dialog is open; the dialogs mount lazily so the
  // builder/upload hooks only run once a lane is actually picked.
  const [createDialog, setCreateDialog] = useState<'builder' | 'upload' | null>(
    null,
  );
  // The org page lists EVERY automation — project-pinned rows carry a chip
  // and link into their project — since project navigation has no
  // Automations tab (tasks are the project-side interface).
  const automationsQuery = useAutomations(
    organizationId,
    projectId,
    projectId === undefined,
  );
  const { projects } = useProjects(organizationId);
  const projectNames = new Map<string, string>(
    projects.map((project) => [project._id, project.name]),
  );
  // Mirrors the backend gate: authoring is an owner/admin/developer act
  // (`requireOrgAdminOrDeveloper`), so nobody else gets a button that can
  // only fail server-side.
  const canAuthor = ability.can('read', 'developerSettings');

  const automations = [...(automationsQuery.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // One create entry, the skill library's grammar: a single primary button
  // whose menu offers the lanes (author from a goal, upload a pack).
  const createMenuGroups: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: t('createMenu.fromGoal'),
        icon: Plus,
        onClick: () => setCreateDialog('builder'),
      },
      {
        type: 'item',
        label: t('upload.trigger'),
        icon: FileUp,
        onClick: () => setCreateDialog('upload'),
      },
    ],
  ];

  return (
    <ContentArea variant="narrow" className="flex-1">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <SectionHeader
          as="h2"
          size="lg"
          title={<span id={headingId}>{t('title')}</span>}
          description={t('list.description')}
          action={
            canAuthor ? (
              <DropdownMenu
                items={createMenuGroups}
                trigger={
                  <Button icon={Plus} data-testid="new-automation">
                    {t('builder.new')}
                  </Button>
                }
              />
            ) : undefined
          }
        />

        {createDialog === 'builder' && (
          <NewAutomationDialog
            organizationId={organizationId}
            {...(projectId !== undefined && { projectId })}
            open
            onOpenChange={(next) => {
              if (!next) setCreateDialog(null);
            }}
          />
        )}
        {createDialog === 'upload' && (
          <UploadAutomationDialog
            organizationId={organizationId}
            {...(projectId !== undefined && { projectId })}
            open
            onOpenChange={(next) => {
              if (!next) setCreateDialog(null);
            }}
          />
        )}

        {automationsQuery.isError && (
          <Alert
            variant="destructive"
            description={t('list.loadFailed', {
              error: automationErrorMessage(automationsQuery.error),
            })}
          />
        )}

        {automationsQuery.isPending && !automationsQuery.isError && (
          <ListLoading />
        )}

        {automationsQuery.data !== undefined &&
          (automations.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title={t('list.empty.title')}
              description={t('list.empty.description')}
              headingLevel={2}
            />
          ) : (
            // Deliberately a list of link cards rather than a DataTable: a row
            // is a pure navigation target — it carries no row action, and the
            // listing is short and already ordered by name, so sorting and
            // filtering would add chrome without answering a question.
            <ul className="flex flex-col gap-2">
              {automations.map((automation) => {
                // The listing omits `deployedVersion` entirely for an automation
                // that has no deployment, so its absence IS the "drafts only"
                // answer rather than a missing field.
                const deployedVersion =
                  'deployedVersion' in automation
                    ? automation.deployedVersion
                    : undefined;
                // A single-bound automation opens inside its project shell;
                // org-level and multi-bound ones open the org detail page —
                // there is no one project to route into.
                const soleProjectId =
                  automation.projectIds.length === 1
                    ? automation.projectIds[0]
                    : undefined;
                const rowProjectId = projectId ?? soleProjectId;
                const linkTarget = rowProjectId
                  ? {
                      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug' as const,
                      params: {
                        id: organizationId,
                        projectId: rowProjectId,
                        automationSlug: automationSlugToParam(automation.name),
                      },
                    }
                  : {
                      to: '/dashboard/$id/automations/$automationSlug' as const,
                      params: {
                        id: organizationId,
                        automationSlug: automationSlugToParam(automation.name),
                      },
                    };
                return (
                  <li key={automation.name}>
                    <Link
                      {...linkTarget}
                      className="border-border bg-card hover:bg-muted/50 focus-visible:ring-ring flex flex-wrap items-center gap-3 rounded-md border p-3 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {automation.name}
                      </span>
                      {projectId === undefined &&
                        automation.projectIds.map((boundProjectId) => (
                          <Badge
                            key={boundProjectId}
                            variant="blue"
                            icon={FolderKanban}
                          >
                            {projectNames.get(boundProjectId) ??
                              t('list.projectBound')}
                          </Badge>
                        ))}
                      <Badge variant="slate">
                        {t('list.versionCount', { count: automation.latest })}
                      </Badge>
                      {deployedVersion === undefined ? (
                        <Badge variant="yellow" icon={CircleDashed}>
                          {t('list.notDeployed')}
                        </Badge>
                      ) : (
                        <Badge variant="green" icon={CheckCircle2}>
                          {t('detail.deployedVersion', {
                            version: deployedVersion,
                          })}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
      </section>
    </ContentArea>
  );
}
