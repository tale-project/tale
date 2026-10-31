'use client';

import { HeaderBreadcrumbSwitcher } from '@tale/ui/header-breadcrumb-switcher';
import type { SearchableSelectOption } from '@tale/ui/searchable-select';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useProjectChoices } from '../hooks/queries';
import { projectSwitchPathname } from '../lib/project-switch-path';

/** Sentinel value for the Tasks-only "All projects" aggregate scope. */
const ALL_PROJECTS_SWITCHER_VALUE = '__all_projects__';

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
 * The menu offers Home's page of projects and, for what is typed, the
 * server's name search past it — never every project (#5194).
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
  const [query, setQuery] = useState('');
  const { projects, isDone, error, isRetrying, retry } = useProjectChoices(
    organizationId,
    query,
  );

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
    // The current project may lie past the page: it stays offered, under the
    // name the breadcrumb shows, without a read of its own. A page that holds
    // every project lacks it only when it is archived, which the menu never
    // offered; with nothing else to switch to, the plain name stays.
    if (
      isDone === false &&
      projectOptions.length > 0 &&
      !projects.some((project) => project._id === projectId)
    ) {
      projectOptions.push({ value: projectId, label: projectName });
    }
    if (!onTasksPath) return projectOptions;
    return [
      {
        value: ALL_PROJECTS_SWITCHER_VALUE,
        label: t('switcher.allProjects'),
      },
      ...projectOptions,
    ];
  }, [projects, isDone, projectId, projectName, onTasksPath, t]);

  const selectedValue = allProjectsActive
    ? ALL_PROJECTS_SWITCHER_VALUE
    : projectId;

  if (error) {
    return (
      <div role="alert" className="inline-flex items-center gap-2">
        <span>{displayName}</span>
        <span>{t('switcher.readError')}</span>
        <button
          type="button"
          className="focus-visible:ring-ring text-sm underline focus-visible:ring-2 focus-visible:outline-none"
          disabled={isRetrying}
          aria-busy={isRetrying}
          onClick={retry}
        >
          {isRetrying ? t('switcher.retrying') : t('switcher.retry')}
        </button>
      </div>
    );
  }

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
      onSearchChange={setQuery}
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
            // A folder belongs to one project: the next project's Files tab
            // opens at its root, never on the previous project's folder
            // (#3918).
            delete next.folderId;
            return next;
          },
        });
      }}
    />
  );
}
