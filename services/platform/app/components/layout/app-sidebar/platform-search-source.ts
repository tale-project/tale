'use client';

/**
 * Combined ⌘K source: projects, tasks, chats, documents, and contacts. Child
 * sources are hook-shaped and must run every render in a fixed order — this
 * factory is memoised at the call site for that reason. `scope: 'chats'`
 * keeps every child hook mounted but only returns chat rows (other sources
 * run inactive so they do not fetch).
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

import type { SearchScope } from './sidebar-context';

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
  /** Defaults to org-wide. `chats` returns only chat hits. */
  scope?: SearchScope;
}

export function createPlatformSearchSource(
  options: PlatformSearchSourceOptions,
): SearchSource<PlatformSearchHitData> {
  const { organizationId, include, scope = 'everything' } = options;
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
    const chatsOnly = scope === 'chats';
    // Keep hook order fixed; park non-chat sources when scoped to chats.
    const broadCtx = chatsOnly ? { ...ctx, active: false } : ctx;
    const projects = projectsSource(query, broadCtx);
    const tasks = tasksSource(query, broadCtx);
    const chats = chatSource(query, ctx);
    const documents = documentsSource(query, broadCtx);
    const contacts = contactsSource(query, broadCtx);

    const results = useMemo<SearchResult<PlatformSearchHitData>[]>(() => {
      const chatRows: SearchResult<PlatformSearchHitData>[] = chats.results.map(
        (hit) => ({
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          group: 'chat',
          data: { kind: 'chat' as const },
        }),
      );
      if (chatsOnly) return chatRows;

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
      chatsOnly,
      projects.results,
      tasks.results,
      chats.results,
      documents.results,
      contacts.results,
    ]);

    if (!ctx.active || query.trim().length === 0) {
      return { results: NO_RESULTS, status: 'ready' };
    }

    const loading = chatsOnly
      ? chats.status === 'loading'
      : projects.status === 'loading' ||
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
