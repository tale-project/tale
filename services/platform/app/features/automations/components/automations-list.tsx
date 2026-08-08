'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  FolderKanban,
  Plus,
  Workflow,
} from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

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
 *
 * The area shell already owns the page title (`AdaptiveHeaderTitle`), so this
 * list does not repeat "Automations". Create lives on the empty state when the
 * list is empty, and beside the list description when it isn't.
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
  const { locale } = useLocale();
  const ability = useAbility();
  // Which create lane's dialog is open; the dialogs mount lazily so the
  // builder/upload hooks only run once a lane is actually picked.
  const [createDialog, setCreateDialog] = useState<'builder' | 'upload' | null>(
    null,
  );
  // The org page lists EVERY automation — project-pinned rows carry a chip
  // and link into their project. The project shell also shows an Automations
  // tab once something is bound to it, so this component serves both.
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
  const isEmpty =
    automationsQuery.data !== undefined && automations.length === 0;

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
  const createControl = canAuthor ? (
    <DropdownMenu
      items={createMenuGroups}
      trigger={
        <Button icon={Plus} data-testid="new-automation">
          {t('builder.new')}
        </Button>
      }
    />
  ) : undefined;

  return (
    <ContentArea variant="narrow" className="flex min-h-0 flex-1">
      <section
        aria-label={t('title')}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        {/* List chrome only when there is something to describe — empty state
            carries its own CTA so we don't stack a second "Automations" title
            under the page header. */}
        {!isEmpty && automationsQuery.data !== undefined && (
          <HStack justify="between" align="start" gap={4}>
            <Text variant="muted" className="text-sm">
              {t('list.description')}
            </Text>
            {createControl}
          </HStack>
        )}

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
          (isEmpty ? (
            <EmptyState
              icon={Workflow}
              title={t('list.empty.title')}
              description={t('list.empty.description')}
              headingLevel={2}
              action={createControl}
              className="min-h-0"
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
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {automationDisplayName(
                            automation.presentation,
                            automation.name,
                            locale,
                          )}
                        </span>
                        {/* The slug stays visible on the admin surface: it is
                            what the store, the CLI and the run log address. */}
                        <span className="text-muted-foreground truncate text-xs">
                          {automation.name}
                        </span>
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
