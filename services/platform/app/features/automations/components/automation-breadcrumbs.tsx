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
 * leads there too. A project the read answers without (deleted, or out of
 * this person's reach) has no tab to return to, so the trail is then the
 * organization's.
 */

import {
  HEADER_CRUMB_LINK_CLASS,
  HeaderBreadcrumbs,
} from '@tale/ui/header-breadcrumbs';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Tooltip } from '@tale/ui/tooltip';
import { createLink, Link, useMatch } from '@tanstack/react-router';
import {
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type PointerEvent,
} from 'react';

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
   *  the project route — unless the project is gone, when the trail is the
   *  organization's. */
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

  // The project the automation is opened in; the project shell's loader
  // already read it, so it is usually there on the first frame. Outside a
  // project the read is skipped.
  const projectRead = useProject(
    projectId !== undefined ? asProjectId(projectId) : undefined,
  );
  // The read ANSWERED without a project: it is gone, or out of this person's
  // reach. Its Automations tab would only say the project was not found, so
  // the trail is the organization's, as for an automation opened outside a
  // project. A read that failed is not that: the project trail stays, and
  // the tab it leads to names the failure and offers a retry.
  const projectGone =
    projectId !== undefined &&
    !projectRead.isLoading &&
    projectRead.project === null &&
    !projectRead.unavailable;
  const trailProjectId = projectGone ? undefined : projectId;

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
    trailProjectId !== undefined ? (
      <Link
        to="/dashboard/$id/projects/$projectId/automations"
        params={{ id: organizationId, projectId: trailProjectId }}
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
  // bare entity URL would only forward there. It stays on the route the run
  // was opened under: an automation's pages inside a project render without
  // the project's own shell, so they open even when the project is gone.
  // Capped like the project's name, so a long name leaves the leaf its room.
  const automationCrumb =
    projectId !== undefined ? (
      <CappedCrumbLink
        to="/dashboard/$id/projects/$projectId/automations/$automationSlug/editor"
        params={{
          id: organizationId,
          projectId,
          automationSlug: slugParam,
        }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
        fullName={displayName}
      >
        {displayName}
      </CappedCrumbLink>
    ) : (
      <CappedCrumbLink
        to="/dashboard/$id/automations/$automationSlug/editor"
        params={{ id: organizationId, automationSlug: slugParam }}
        activeOptions={{ exact: true }}
        className={HEADER_CRUMB_LINK_CLASS}
        fullName={displayName}
      >
        {displayName}
      </CappedCrumbLink>
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
        ...(trailProjectId !== undefined
          ? [
              {
                key: 'project',
                content: (
                  <ProjectCrumb
                    organizationId={organizationId}
                    projectId={trailProjectId}
                    project={projectRead.project}
                    isLoading={projectRead.isLoading}
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
 * The project an automation was opened in, leading back to it. Like the
 * Automations crumb it is an ancestor of the current URL, so it matches
 * exactly. A long name is capped, so the automation's own name keeps its
 * room. A read that failed leaves the way out the project's error page
 * offers: the project list.
 */
function ProjectCrumb({
  organizationId,
  projectId,
  project,
  isLoading,
}: {
  organizationId: string;
  projectId: string;
  project: { name: string } | null;
  isLoading: boolean;
}) {
  const { t } = useT('projects');

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
    <CappedCrumbLink
      to="/dashboard/$id/projects/$projectId"
      params={{ id: organizationId, projectId }}
      activeOptions={{ exact: true }}
      className={HEADER_CRUMB_LINK_CLASS}
      fullName={project.name}
    >
      {project.name}
    </CappedCrumbLink>
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

/**
 * An ancestor crumb that names one thing — a project, an automation — whose
 * name can be long. It is capped in width so the trail keeps room for the
 * page's own title, and while the name is cut its whole text shows in a
 * tooltip, on hover and on keyboard focus alike; the accessible name is
 * always whole. The crumb's list item is a flex row, which already makes
 * the link a block box, so the cap carries no display class — and must not:
 * the phone's back arrow re-uses the immediate parent's link, with an icon
 * in place of the name, and keeps the icon button's own layout. An icon
 * never overflows, so the arrow opens no tip.
 */
function CappedCrumbAnchor({
  fullName,
  children,
  className,
  onPointerEnter,
  onFocus,
  ...props
}: ComponentProps<'a'> & { fullName: string }) {
  const [open, setOpen] = useState(false);
  // Measured when a tip can open — on pointer entry and on focus — rather
  // than observed: the cut only matters at those moments.
  const cut = useRef(false);
  const measure = (element: HTMLAnchorElement) => {
    cut.current = element.scrollWidth > element.clientWidth + 1;
  };

  return (
    <Tooltip
      content={fullName}
      open={open}
      onOpenChange={(next) => setOpen(next && cut.current)}
    >
      <a
        {...props}
        // Joined, not merged: the back arrow's icon-button classes arrive
        // here too, and must reach the link exactly as they would without
        // the cap.
        className={`max-w-48 truncate ${className ?? ''}`.trim()}
        onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
          measure(event.currentTarget);
          onPointerEnter?.(event);
        }}
        onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
          measure(event.currentTarget);
          onFocus?.(event);
        }}
      >
        {children}
      </a>
    </Tooltip>
  );
}

const CappedCrumbLink = createLink(CappedCrumbAnchor);
