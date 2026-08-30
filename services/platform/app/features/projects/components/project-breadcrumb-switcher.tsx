'use client';

import { Badge } from '@tale/ui/badge';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { useMemo } from 'react';

import { HeaderBreadcrumbSwitcher } from '@/app/components/layout/header-breadcrumb-switcher';
import type { SearchableSelectOption } from '@/app/components/ui/forms/searchable-select';
import { useT } from '@/lib/i18n/client';

import { useProjects } from '../hooks/queries';
import { projectSwitchPathname } from '../lib/project-switch-path';

/** Sentinel value for the Tasks-only "All projects" aggregate scope. */
export const ALL_PROJECTS_SWITCHER_VALUE = '__all_projects__';

/** True when the pathname is a project Tasks view (board/list/alias). */
export function isProjectTasksPath(
  pathname: string,
  projectId: string,
): boolean {
  const prefix = `/projects/${projectId}/tasks`;
  return pathname.includes(prefix);
}

/**
 * Breadcrumb leaf for a project detail page: the shared
 * `HeaderBreadcrumbSwitcher` over the org's projects, so the operator can jump
 * between them without returning to the Projects list. Portable tabs (files,
 * tasks, overview, …) stay put; bound-view / nested-automation paths reset to
 * Tasks.
 *
 * On Tasks paths the menu also offers "All projects" — an aggregate board that
 * disables the non-Tasks project tabs while active (`?projects=all`).
 */
export function ProjectBreadcrumbSwitcher({
  organizationId,
  projectId,
  projectName,
}: {
  organizationId: string;
  projectId: string;
  projectName: string;
}) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const location = useLocation();
  const { projects } = useProjects(organizationId);

  const onTasksPath = isProjectTasksPath(location.pathname, projectId);
  const allProjectsActive =
    onTasksPath &&
    (location.search as { projects?: unknown }).projects === 'all';
  const displayName = allProjectsActive
    ? t('switcher.allProjects')
    : projectName;

  const options = useMemo<SearchableSelectOption[]>(() => {
    const projectOptions = projects.map((project) => ({
      value: project._id,
      label: project.name,
    }));
    if (!onTasksPath) return projectOptions;
    return [
      {
        value: ALL_PROJECTS_SWITCHER_VALUE,
        label: t('switcher.allProjects'),
        // Blue badge + Layers marks the aggregate scope as different from a
        // named project row — the same icon appears on the breadcrumb trigger
        // while the mode is active.
        labelBadge: (
          <Badge variant="blue" icon={Layers} className="py-0.5 text-[10px]">
            {t('switcher.allProjectsBadge')}
          </Badge>
        ),
      },
      ...projectOptions,
    ];
  }, [projects, onTasksPath, t]);

  const selectedValue = allProjectsActive
    ? ALL_PROJECTS_SWITCHER_VALUE
    : projectId;

  return (
    <HeaderBreadcrumbSwitcher
      value={selectedValue}
      options={options}
      displayName={displayName}
      title={t('switcher.title')}
      searchPlaceholder={t('switcher.searchPlaceholder')}
      emptyText={t('switcher.empty')}
      ariaLabel={t('switcher.ariaLabel', { name: displayName })}
      {...(allProjectsActive && { leadingIcon: Layers })}
      onValueChange={(nextId) => {
        if (nextId === ALL_PROJECTS_SWITCHER_VALUE) {
          void navigate({
            to: location.pathname,
            search: (prev) => ({
              ...prev,
              projects: 'all' as const,
            }),
          });
          return;
        }

        const to = projectSwitchPathname(
          location.pathname,
          organizationId,
          projectId,
          nextId,
        );
        void navigate({
          to,
          search: (prev) => {
            const next = { ...prev };
            delete next.projects;
            return next;
          },
        });
      }}
    />
  );
}
