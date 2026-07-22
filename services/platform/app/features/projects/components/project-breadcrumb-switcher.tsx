'use client';

import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useProjects } from '../hooks/queries';
import { projectSwitchPathname } from '../lib/project-switch-path';

/**
 * Breadcrumb leaf for a project detail page: the current project name opens a
 * dropdown of sibling projects so the operator can jump between them without
 * returning to the Projects list. Portable tabs (files, tasks, …) stay put;
 * bound-view / nested-automation paths reset to the overview.
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

  const items = useMemo<DropdownMenuGroup[]>(
    () => [
      projects.map((project) => ({
        type: 'item' as const,
        label: project.name,
        selected: project._id === projectId,
        onClick: () => {
          if (project._id === projectId) return;
          const to = projectSwitchPathname(
            location.pathname,
            organizationId,
            projectId,
            project._id,
          );
          void navigate({ to, search: location.search });
        },
      })),
    ],
    [
      projects,
      projectId,
      organizationId,
      navigate,
      location.pathname,
      location.search,
    ],
  );

  // Nothing to switch to yet (list still empty / loading) — keep the plain
  // name so the h1 leaf stays readable without a dead chevron.
  if (projects.length === 0) {
    return <>{projectName}</>;
  }

  return (
    <DropdownMenu
      align="start"
      items={items}
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
