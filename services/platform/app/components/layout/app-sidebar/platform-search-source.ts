'use client';

/**
 * Combined ⌘K source: projects, tasks, chats, documents, and contacts. Child
 * sources are hook-shaped and must run every render in a fixed order — this
 * factory is memoised at the call site for that reason. `scope: 'chats'`
 * keeps every child hook mounted but only returns chat rows (other sources
 * run inactive so they do not fetch).
 */

import type {
  SearchResult,
  SearchSource,
  SearchSourceState,
} from '@tale/ui/search';
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

/** How one child source's search stands, whatever rows it carries. */
type ChildSearch = Pick<
  SearchSourceState,
  'status' | 'error' | 'retry' | 'retrying'
>;

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
  const askProjects = include?.projects !== false;
  const askDocuments = include?.documents !== false;
  const askContacts = include?.contacts !== false;
  const projectsSource = createProjectsSearchSource({
    organizationId,
    enabled: askProjects,
  });
  const tasksSource = createTasksSearchSource({ organizationId });
  const chatSource = createChatSearchSource({ organizationId });
  const documentsSource = createDocumentsSearchSource({
    organizationId,
    enabled: askDocuments,
  });
  const contactsSource = createContactsSearchSource({
    organizationId,
    enabled: askContacts,
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
          ...hit,
          group: 'chat',
          data: { kind: 'chat' as const },
        }),
      );
      if (chatsOnly) return chatRows;

      const projectRows: SearchResult<PlatformSearchHitData>[] =
        projects.results.map((hit) => ({
          ...hit,
          group: 'projects',
          data: hit.data ?? { kind: 'project' as const },
        }));
      const taskRows: SearchResult<PlatformSearchHitData>[] = [];
      for (const hit of tasks.results) {
        if (hit.data === undefined) continue;
        taskRows.push({
          ...hit,
          group: 'tasks',
          data: hit.data,
        });
      }
      const documentRows: SearchResult<PlatformSearchHitData>[] = [];
      for (const hit of documents.results) {
        if (hit.data === undefined) continue;
        documentRows.push({
          ...hit,
          group: 'documents',
          data: hit.data,
        });
      }
      const contactRows: SearchResult<PlatformSearchHitData>[] =
        contacts.results.map((hit) => ({
          ...hit,
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

    // The sources this scope asks. One left out (`include`) neither answers
    // nor fails, so it does not count toward "every source failed".
    const asked: ChildSearch[] = chatsOnly
      ? [chats]
      : [
          ...(askProjects ? [projects] : []),
          tasks,
          chats,
          ...(askDocuments ? [documents] : []),
          ...(askContacts ? [contacts] : []),
        ];
    // A failed source is the palette's to name and retry, never a group
    // that quietly went missing (#4890): every source failing is the
    // palette's error; some failing keeps what the others found, with one
    // line saying the rest could not load. Try again asks again only what
    // failed, and not what is already being asked again.
    const failed = asked.filter((source) => source.status === 'error');
    const retrying = failed.some((source) => source.retrying === true);
    const retry =
      failed.length === 0
        ? undefined
        : () => {
            for (const source of failed) {
              if (source.retrying !== true) source.retry?.();
            }
          };
    if (failed.length > 0 && failed.length === asked.length) {
      return {
        results: NO_RESULTS,
        status: 'error',
        error: failed[0]?.error ?? null,
        retry,
        retrying,
      };
    }
    return {
      results,
      status: asked.some((source) => source.status === 'loading')
        ? 'loading'
        : 'ready',
      ...(failed.length > 0 ? { partialFailure: true, retry, retrying } : {}),
    };
  };
}
