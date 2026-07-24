'use client';

import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useProjects } from '../hooks/queries';
import { projectSwitchPathname } from '../lib/project-switch-path';

/**
 * Breadcrumb leaf for a project detail page: the current project name opens a
 * searchable switcher of sibling projects so the operator can jump between them
 * without returning to the Projects list. Portable tabs (files, tasks, …) stay
 * put; bound-view / nested-automation paths reset to the overview.
 */
export function ProjectBreadcrumbSwitcher({
  organizationId,
  projectId,
  projectName,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  projectName: string;
}) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const location = useLocation();
  const { projects } = useProjects(organizationId);

  const options = useMemo<SearchableSelectOption[]>(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.name,
      })),
    [projects],
  );

  // Nothing to switch to yet (list still empty / loading) — keep the plain
  // name so the h1 leaf stays readable without a dead chevron.
  if (options.length === 0) {
    return <>{projectName}</>;
  }

  return (
    <SearchableSelect
      variant="switcher"
      align="start"
      contentClassName="min-w-64"
      value={projectId}
      options={options}
      title={t('switcher.title')}
      searchPlaceholder={t('switcher.searchPlaceholder')}
      emptyText={t('switcher.empty')}
      aria-label={t('switcher.ariaLabel', { name: projectName })}
      onValueChange={(nextId) => {
        if (nextId === projectId) return;
        const to = projectSwitchPathname(
          location.pathname,
          organizationId,
          projectId,
          nextId,
        );
        void navigate({ to, search: location.search });
      }}
      trigger={
        <button
          type="button"
          aria-label={t('switcher.ariaLabel', { name: projectName })}
          className={cn(
            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm',
            'hover:text-muted-foreground transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          <span className="min-w-0 truncate">{projectName}</span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
      }
    />
  );
}
