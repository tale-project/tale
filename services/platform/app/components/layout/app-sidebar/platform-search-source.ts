'use client';

/**
 * Combined ⌘K source: projects, tasks, chats, documents, and contacts. Child
 * sources are hook-shaped and must run every render in a fixed order — this
 * factory is memoised at the call site for that reason.
 */

import type { SearchResult, SearchSource } from '@tale/ui/search';
import { useMemo } from 'react';

import { createChatSearchSource } from '@/app/features/chat/data/chat-search-source';
import { createContactsSearchSource } from '@/app/features/contacts/data/contacts-search-source';
import type { ContactSearchHitData } from '@/app/features/contacts/data/contacts-search-source';
import { createDocumentsSearchSource } from '@/app/features/documents/data/documents-search-source';
import type { DocumentSearchHitData } from '@/app/features/documents/data/documents-search-source';
import { createProjectsSearchSource } from '@/app/features/projects/data/projects-search-source';
import type { ProjectSearchHitData } from '@/app/features/projects/data/projects-search-source';
import {
  createTasksSearchSource,
  type TaskSearchHitData,
} from '@/app/features/tasks/data/tasks-search-source';

export type PlatformSearchHitData =
  | ProjectSearchHitData
  | TaskSearchHitData
  | { kind: 'chat' }
  | DocumentSearchHitData
  | ContactSearchHitData;

const NO_RESULTS: SearchResult<PlatformSearchHitData>[] = [];

export interface PlatformSearchSourceOptions {
  organizationId: string;
  include?: {
    projects?: boolean;
    documents?: boolean;
    contacts?: boolean;
  };
}

export function createPlatformSearchSource(
  options: PlatformSearchSourceOptions,
): SearchSource<PlatformSearchHitData> {
  const { organizationId, include } = options;
  const projectsSource = createProjectsSearchSource({
    organizationId,
    enabled: include?.projects !== false,
  });
  const tasksSource = createTasksSearchSource({ organizationId });
  const chatSource = createChatSearchSource({ organizationId });
  const documentsSource = createDocumentsSearchSource({
    organizationId,
    enabled: include?.documents !== false,
  });
  const contactsSource = createContactsSearchSource({
    organizationId,
    enabled: include?.contacts !== false,
  });

  return (query, ctx) => {
    const projects = projectsSource(query, ctx);
    const tasks = tasksSource(query, ctx);
    const chats = chatSource(query, ctx);
    const documents = documentsSource(query, ctx);
    const contacts = contactsSource(query, ctx);

    const results = useMemo<SearchResult<PlatformSearchHitData>[]>(() => {
      const projectRows: SearchResult<PlatformSearchHitData>[] =
        projects.results.map((hit) => ({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'projects',
          data: hit.data ?? { kind: 'project' as const },
        }));
      const taskRows: SearchResult<PlatformSearchHitData>[] = [];
      for (const hit of tasks.results) {
        if (hit.data === undefined) continue;
        taskRows.push({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'tasks',
          data: hit.data,
        });
      }
      const chatRows: SearchResult<PlatformSearchHitData>[] = chats.results.map(
        (hit) => ({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'chat',
          data: { kind: 'chat' as const },
        }),
      );
      const documentRows: SearchResult<PlatformSearchHitData>[] = [];
      for (const hit of documents.results) {
        if (hit.data === undefined) continue;
        documentRows.push({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'documents',
          data: hit.data,
        });
      }
      const contactRows: SearchResult<PlatformSearchHitData>[] =
        contacts.results.map((hit) => ({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'contacts',
          data: hit.data ?? { kind: 'contact' as const },
        }));
      return [
        ...projectRows,
        ...taskRows,
        ...chatRows,
        ...documentRows,
        ...contactRows,
      ];
    }, [
      projects.results,
      tasks.results,
      chats.results,
      documents.results,
      contacts.results,
    ]);

    if (!ctx.active || query.trim().length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }

    const loading =
      projects.status === 'loading' ||
      tasks.status === 'loading' ||
      chats.status === 'loading' ||
      documents.status === 'loading' ||
      contacts.status === 'loading';
    return {
      results,
      status: loading ? 'loading' : 'ready',
    };
  };
}
