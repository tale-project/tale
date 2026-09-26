'use client';

/**
 * The Home panel's PROJECTS section: one row per project, each a door into
 * the project (its board, files and chats open beside the panel) and a drop
 * target — drag a chat onto a project to file it there. Pinned projects lead,
 * the rest read alphabetically, and the section keeps at most half the panel
 * so the stream below always stays in reach.
 */

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  SubPanelDisclosureBody,
  useSubPanelRowTreatment,
} from '@tale/ui/sub-panel-list';
import { Tooltip } from '@tale/ui/tooltip';
import { toast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronRight,
  FolderPlus,
  LayoutList,
  MoreHorizontal,
  Pin,
  PinOff,
  SquarePen,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { ProjectRowsSkeleton } from '@/app/components/layout/home-panel-skeleton';
import {
  dropZoneClassName,
  useProjectDropZone,
} from '@/app/features/chat/components/thread-dnd';
import { useProjectPin } from '@/app/features/chat/data/chat-backend';
import type { ChatProjectSummary } from '@/app/features/chat/types';
import { ProjectAvatar } from '@/app/features/projects/components/project-avatar';
import { ProjectCreateDialog } from '@/app/features/projects/components/project-create-dialog';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

function HomeProjectRow({
  organizationId,
  project,
  active,
}: {
  organizationId: string;
  project: ChatProjectSummary;
  active: boolean;
}) {
  const { t } = useT('home');
  const { t: tChat } = useT('chat');
  const navigate = useNavigate();
  const treatment = useSubPanelRowTreatment(active);
  const { setNodeRef, isOver } = useProjectDropZone(project.id);
  const { setPinned } = useProjectPin(organizationId);
  const pinned = project.pinnedAt !== undefined;

  const menuItems: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: tChat('newChat'),
        icon: SquarePen,
        onClick: () =>
          void navigate({
            to: '/dashboard/$id/chat',
            params: { id: organizationId },
            search: { projectId: project.id },
          }),
      },
      {
        type: 'item',
        label: pinned ? tChat('unpinProject') : tChat('pinProject'),
        icon: pinned ? PinOff : Pin,
        onClick: () => {
          setPinned(project.id, !pinned).catch((error: unknown) => {
            console.error('Failed to update project pin:', error);
            toast({ title: tChat('pinFailed'), variant: 'destructive' });
          });
        },
      },
    ],
  ];

  return (
    <li
      ref={setNodeRef}
      className={cn('group relative', dropZoneClassName(isOver))}
    >
      <Link
        to="/dashboard/$id/projects/$projectId"
        params={{ id: organizationId, projectId: project.id }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-visible:ring-ring flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          active
            ? treatment.className
            : 'text-foreground/90 hover:bg-muted/60 hover:text-foreground',
        )}
        {...(active && treatment.style !== undefined
          ? { style: treatment.style }
          : {})}
      >
        <ProjectAvatar
          name={project.name}
          icon={project.icon}
          color={project.color}
          size={16}
        />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {pinned && (
          <Pin
            aria-label={tChat('pinned')}
            className="text-muted-foreground size-3 shrink-0 transition-opacity md:group-hover:opacity-0 md:group-has-[[data-state=open]]:opacity-0"
          />
        )}
      </Link>
      <div className="bg-background/85 absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-md opacity-100 backdrop-blur-sm transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">
        <DropdownMenu
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-6 p-1"
              aria-label={t('projects.actions', { project: project.name })}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
          items={menuItems}
        />
      </div>
    </li>
  );
}

export function HomeProjects({
  organizationId,
  projects,
  loading,
  activeProjectId,
}: {
  organizationId: string;
  projects: readonly ChatProjectSummary[];
  loading: boolean;
  activeProjectId?: string;
}) {
  const { t } = useT('home');
  const [open, setOpen] = usePersistedState(
    `home-projects-open-${organizationId}`,
    true,
  );
  const [createOpen, setCreateOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.pinnedAt !== undefined && b.pinnedAt !== undefined) {
          return b.pinnedAt - a.pinnedAt;
        }
        if (a.pinnedAt !== undefined) return -1;
        if (b.pinnedAt !== undefined) return 1;
        return a.name.localeCompare(b.name, undefined, {
          sensitivity: 'base',
        });
      }),
    [projects],
  );

  return (
    <section
      aria-label={t('projects.title')}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col"
    >
      <div className="flex h-7 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-[11px] font-semibold tracking-wider uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          <span className="truncate">{t('projects.title')}</span>
          {!open && projects.length > 0 && (
            <span className="text-muted-foreground/70 font-medium tabular-nums">
              {projects.length}
            </span>
          )}
        </button>
        <Tooltip content={t('projects.allProjects')} side="bottom">
          <Button
            asChild
            size="icon"
            variant="ghost"
            aria-label={t('projects.allProjects')}
            className="text-muted-foreground hover:text-foreground size-6 p-1"
          >
            <Link to="/dashboard/$id/projects" params={{ id: organizationId }}>
              <LayoutList className="size-3.5" />
            </Link>
          </Button>
        </Tooltip>
        <Tooltip content={t('projects.newProject')} side="bottom">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCreateOpen(true)}
            aria-label={t('projects.newProject')}
            className="text-muted-foreground hover:text-foreground size-6 p-1"
          >
            <FolderPlus className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
      <SubPanelDisclosureBody open={open} className="min-h-0">
        <div className="scrollbar-thin max-h-full overflow-y-auto">
          {loading ? (
            <Skeletonize loading className="flex flex-col gap-0.5 py-0.5">
              <ProjectRowsSkeleton />
            </Skeletonize>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              {t('projects.empty')}
            </p>
          ) : (
            <ul role="list" className="flex flex-col gap-0.5 py-0.5">
              {sorted.map((project) => (
                <HomeProjectRow
                  key={project.id}
                  organizationId={organizationId}
                  project={project}
                  active={project.id === activeProjectId}
                />
              ))}
            </ul>
          )}
        </div>
      </SubPanelDisclosureBody>
      {createOpen && (
        <ProjectCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
        />
      )}
    </section>
  );
}
