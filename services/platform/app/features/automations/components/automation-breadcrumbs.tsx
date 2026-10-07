'use client';

/**
 * The adaptive-header trail for one automation (and its runs).
 *
 * On the automation page: `Automations / <name>` — the Automations crumb
 * returns to the org Automations hub, and the name leaf is the shared
 * breadcrumb switcher over sibling automations, exactly like a project's
 * name. On a run page: `Automations / <name> / Run` — the name crumb returns
 * to this automation as a plain link, and the mobile back arrow follows that
 * immediate parent.
 *
 * Opened inside a project, the trail starts at the project:
 * `<project> / Automations / <name>` (and `… / Run`). The project's name
 * returns to the project, and Automations to the project's own Automations
 * tab, the list the automation was opened from — so the phone's back arrow
 * leads there too.
 */

import { cn } from '@tale/ui/cn';
import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@tale/ui/header-breadcrumbs';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Link, useMatch } from '@tanstack/react-router';

import { useProject } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { useAutomation } from '../hooks/queries';
import { AutomationBreadcrumbSwitcher } from './automation-breadcrumb-switcher';

export function AutomationBreadcrumbs({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** When set, the trail starts at this project and every crumb stays on
   *  the project route. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const automationQuery = useAutomation(organizationId, automationSlug);
  const displayName = automationDisplayName(
    automationQuery.data?.presentation,
    automationSlug,
    locale,
  );
  const slugParam = automationSlugToParam(automationSlug);

  // Either shell can host a run under this slug; the trail only cares that
  // we ARE on a run, so the name crumb can point back at the automation.
  const onOrgRun =
    useMatch({
      from: '/dashboard/$id/automations/$automationSlug/runs/$runId',
      shouldThrow: false,
    }) !== undefined;
  const onProjectRun =
    useMatch({
      from: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId',
      shouldThrow: false,
    }) !== undefined;
  const onRun = onOrgRun || onProjectRun;

  // The list the automation belongs to here: the org hub, or inside a
  // project that project's own Automations tab. An ancestor of the current
  // URL, so it matches exactly: TanStack would otherwise mark it as the
  // current page beside the leaf.
  const listCrumb =
    projectId !== undefined ? (
      <Link
        to="/dashboard/$id/projects/$projectId/automations"
        params={{ id: organizationId, projectId }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {t('title')}
      </Link>
    ) : (
      <Link
        to="/dashboard/$id/automations"
        params={{ id: organizationId }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {t('title')}
      </Link>
    );

  // The automation's default surface, exactly where a list row lands — the
  // bare entity URL would only forward there.
  const automationCrumb =
    projectId !== undefined ? (
      <Link
        to="/dashboard/$id/projects/$projectId/automations/$automationSlug/editor"
        params={{
          id: organizationId,
          projectId,
          automationSlug: slugParam,
        }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {displayName}
      </Link>
    ) : (
      <Link
        to="/dashboard/$id/automations/$automationSlug/editor"
        params={{ id: organizationId, automationSlug: slugParam }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
      >
        {displayName}
      </Link>
    );

  const nameLeaf = (
    <Skeletonize
      loading={automationQuery.isPending}
      label={t('title')}
      className="contents"
    >
      {automationQuery.isPending ? (
        <SkeletonBox>
          <span className="inline-block h-4 w-32 align-middle" />
        </SkeletonBox>
      ) : (
        <AutomationBreadcrumbSwitcher
          organizationId={organizationId}
          automationSlug={automationSlug}
          displayName={displayName}
          {...(projectId !== undefined && { projectId })}
        />
      )}
    </Skeletonize>
  );

  return (
    <HeaderBreadcrumbs
      ariaLabel={tCommon('aria.breadcrumb')}
      crumbs={[
        ...(projectId !== undefined
          ? [
              {
                key: 'project',
                content: (
                  <ProjectCrumb
                    organizationId={organizationId}
                    projectId={projectId}
                  />
                ),
              },
            ]
          : []),
        { key: 'automations', content: listCrumb },
        ...(onRun ? [{ key: 'automation', content: automationCrumb }] : []),
      ]}
      leaf={onRun ? t('runs.breadcrumb') : nameLeaf}
    />
  );
}

/**
 * The project an automation was opened in, leading back to it. The project
 * shell's loader already read it, so the name is usually there on the first
 * frame. Like the Automations crumb it is an ancestor of the current URL, so
 * it matches exactly. A long name truncates, so the automation's own name
 * keeps its room; the accessible name stays whole. A project that cannot be
 * read leaves the way out its not-found page offers: the project list.
 */
function ProjectCrumb({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useT('projects');
  const { project, isLoading } = useProject(asProjectId(projectId));

  if (isLoading) {
    return (
      <Skeletonize loading label={t('title')} className="contents">
        <SkeletonBox>
          <span className="inline-block h-4 w-24 align-middle" />
        </SkeletonBox>
      </Skeletonize>
    );
  }
  return project ? (
    <Link
      to="/dashboard/$id/projects/$projectId"
      params={{ id: organizationId, projectId }}
      activeOptions={{ exact: true }}
      className={cn(HEADER_CRUMB_LINK_CLASS, 'block max-w-48 truncate')}
    >
      {project.name}
    </Link>
  ) : (
    <Link
      to="/dashboard/$id/projects"
      params={{ id: organizationId }}
      activeOptions={{ exact: true }}
      className={HEADER_CRUMB_LINK_CLASS}
    >
      {t('title')}
    </Link>
  );
}
