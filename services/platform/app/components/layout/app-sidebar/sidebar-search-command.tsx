'use client';

import {
  SearchCommand,
  type SearchCommandLabels,
  type SearchResult,
} from '@tale/ui/search';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';

import { TASK_VIEW_ROUTES, type TaskView } from '@/app/features/tasks/lib/view';
import { useAbility } from '@/app/hooks/use-ability';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useT } from '@/lib/i18n/client';

import {
  createPlatformSearchSource,
  type PlatformSearchHitData,
} from './platform-search-source';
import { useSidebar } from './sidebar-context';

function isPlatformHit<K extends PlatformSearchHitData['kind']>(
  data: unknown,
  kind: K,
): data is Extract<PlatformSearchHitData, { kind: K }> {
  if (data === null || typeof data !== 'object') return false;
  return 'kind' in data && data.kind === kind;
}

/** Parse the tasks route when a global task hit should land in context. */
function parseTasksRouteContext(
  pathname: string,
  search: Record<string, unknown>,
): {
  routeProjectId?: string;
  taskView: TaskView;
  allProjects: boolean;
} {
  const match = pathname.match(
    /\/dashboard\/[^/]+\/projects\/([^/]+)\/tasks(?:\/(board|list))?/,
  );
  const taskView: TaskView =
    match?.[2] === 'list' || match?.[2] === 'board' ? match[2] : 'board';
  return {
    routeProjectId: match?.[1],
    taskView,
    allProjects: search.projects === 'all',
  };
}

export interface SidebarSearchCommandProps {
  organizationId: string;
}

/**
 * Global search palette (⌘K / sidebar): projects, tasks, chats, documents,
 * and contacts across the org. Chat's thread-list uses
 * {@link ChatSearchCommand} for a chats-only palette.
 */
export function SidebarSearchCommand({
  organizationId,
}: SidebarSearchCommandProps) {
  const { isSearchOpen, setSearchOpen, setChatSearchOpen } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const isMac = useIsMac();
  const ability = useAbility();
  const { t: tDialogs } = useT('dialogs');

  const include = useMemo(
    () => ({
      projects: ability.can('read', 'projects'),
      documents: ability.can('read', 'documents'),
      contacts: ability.can('read', 'contacts'),
    }),
    [ability],
  );

  const tasksRoute = useMemo(
    () =>
      parseTasksRouteContext(
        location.pathname,
        location.search as Record<string, unknown>,
      ),
    [location.pathname, location.search],
  );

  const searchSource = useMemo(
    () => createPlatformSearchSource({ organizationId, include }),
    [organizationId, include],
  );

  const searchLabels = useMemo<Partial<SearchCommandLabels>>(
    () => ({
      title: tDialogs('search.title'),
      placeholder: tDialogs('search.placeholder'),
      loading: tDialogs('search.loading'),
      noResultsTitle: tDialogs('search.noResults'),
      empty: tDialogs('search.empty'),
      emptyHint: tDialogs('search.emptyHint'),
    }),
    [tDialogs],
  );

  const getGroupLabel = useCallback(
    (key: string) => {
      if (key === 'projects') return tDialogs('search.groupProjects');
      if (key === 'tasks') return tDialogs('search.groupTasks');
      if (key === 'chat') return tDialogs('search.groupChat');
      if (key === 'documents') return tDialogs('search.groupDocuments');
      if (key === 'contacts') return tDialogs('search.groupContacts');
      return key;
    },
    [tDialogs],
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const data = result.data;
      if (isPlatformHit(data, 'project')) {
        void navigate({
          to: '/dashboard/$id/projects/$projectId',
          params: { id: organizationId, projectId: result.id },
        });
        return;
      }
      if (isPlatformHit(data, 'task')) {
        const taskProjectId = data.projectId;
        const onSameTasksRoute =
          tasksRoute.routeProjectId !== undefined &&
          String(taskProjectId) === tasksRoute.routeProjectId;
        const search = {
          task: result.id,
          ...(tasksRoute.allProjects ? { projects: 'all' as const } : {}),
        };
        void navigate({
          to: TASK_VIEW_ROUTES[
            onSameTasksRoute ? tasksRoute.taskView : 'board'
          ],
          params: { id: organizationId, projectId: taskProjectId },
          search,
        });
        return;
      }
      if (isPlatformHit(data, 'document')) {
        if (data.projectId) {
          void navigate({
            to: '/dashboard/$id/projects/$projectId/files',
            params: {
              id: organizationId,
              projectId: data.projectId,
            },
            search: {
              doc: result.id,
              ...(data.folderId ? { folderId: data.folderId } : {}),
            },
          });
          return;
        }
        void navigate({
          to: '/dashboard/$id/documents',
          params: { id: organizationId },
          search: {
            doc: result.id,
            ...(data.folderId ? { folderId: data.folderId } : {}),
          },
        });
        return;
      }
      if (isPlatformHit(data, 'contact')) {
        void navigate({
          to: '/dashboard/$id/contacts',
          params: { id: organizationId },
          search: { query: result.title },
        });
        return;
      }
      void navigate({
        to: '/dashboard/$id/chat/$threadId',
        params: { id: organizationId, threadId: result.id },
      });
    },
    [navigate, organizationId, tasksRoute],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        setChatSearchOpen(false);
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, setChatSearchOpen, setSearchOpen]);

  return (
    <SearchCommand
      open={isSearchOpen}
      onOpenChange={setSearchOpen}
      source={searchSource}
      labels={searchLabels}
      getGroupLabel={getGroupLabel}
      recentsStorageKey="tale.platform.search.recentSearches.v1"
      minQueryLength={2}
      onSelect={handleSelect}
    />
  );
}
