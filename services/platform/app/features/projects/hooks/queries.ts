import { useDebounce } from '@tale/ui/use-debounce';
import { keepPreviousData, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  mergeProjectChoices,
  PROJECT_SEARCH_DEBOUNCE_MS,
  projectSearchTerm,
} from '@/app/features/projects/lib/project-choices';
import { PROJECTS_PAGE_SIZE } from '@/app/features/projects/projects-page-size';
import { useActionQuery } from '@/app/hooks/use-action-query';
import {
  useBackendQueries,
  useBackendQuery,
} from '@/app/hooks/use-backend-query';
import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { ItemOf, PageItemOf, ReturnsOf } from '@/app/lib/backend/contract';
import { NAVIGATOR_PROJECT_LIMIT } from '@/app/lib/backend/projects';
import {
  backendKey,
  projectCapabilityCatalogKey,
} from '@/app/lib/backend/query-keys';
import { readStateOf } from '@/app/lib/backend/read-state';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

/**
 * The shipped harnesses a project agent can run on — the same fixed set the
 * project Agents tab equips — and the models it can call. Reuses the
 * composer's org-scoped listing; chat itself never renders this roster (chat
 * is model selection only). The models are what the org's credentials serve,
 * so the listing keys under their entity: a provider added in settings
 * reaches every agent model picker without a reload.
 */
export function useProjectHarnesses(organizationId: string) {
  return useActionQuery(
    backendKey(organizationId, PROVIDER_CREDENTIAL_HINT_ENTITY, 'agent-roster'),
    'chat/composer:listComposerModels',
    { organizationId },
  );
}

/**
 * The skills + enabled connectors THIS PROJECT's agents can equip. Resolved
 * with the project's own visibility — org-wide skills plus team skills
 * shared with the project's teams — never with the configuring member's, so
 * an agent can only ever be equipped with what every project member's runs
 * may stage.
 */
export function useProjectCapabilityCatalog(
  organizationId: string,
  projectId: string | undefined,
) {
  return useActionQuery(
    projectCapabilityCatalogKey(organizationId, projectId ?? ''),
    'chat/composer:listProjectCapabilities',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `enabled` below skips the query while projectId is undefined
    { organizationId, projectId: projectId as string },
    { enabled: projectId !== undefined },
  );
}

/** The org's agent secrets (name + masked preview + description), for the
 * equipment picker and the secret manager. Values are never returned. */
export function useAgentSecrets(organizationId: string | undefined) {
  return useBackendQuery(
    'agent_secrets/queries:listAgentSecrets',
    organizationId !== undefined ? { organizationId } : 'skip',
  );
}

export type AgentSecretSummary =
  ItemOf<'agent_secrets/queries:listAgentSecrets'>;

/** The org's connector credentials by name (masked; never a value), for
 * the credential an agent acts as per connector — the settings listing,
 * under the same cache entry, so a credential added there shows here. */
export function useOrgConnectorCredentials(organizationId: string | undefined) {
  return useBackendQuery(
    'connector_credentials/queries:listCredentials',
    organizationId !== undefined ? { organizationId } : 'skip',
  );
}

export type ProjectAgentRow = ItemOf<'projects/queries:listProjectAgents'>;

/** The project's agents, oldest first — its standard agent among them once
 * someone handed it work (`managed`). */
export function useProjectAgents(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const query = useBackendQuery(
    'projects/queries:listProjectAgents',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  const { data, isLoading, error, refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    agents: data ?? [],
    hasAnswer: data !== undefined,
    isLoading,
    error,
    ...readStateOf(query),
    retry,
  };
}

export type StandardAgentAvailability =
  ReturnsOf<'projects/queries:getStandardAgent'>;

/**
 * Whether the signed-in person can hand work to the organization's standard
 * agent — the agent Tale provides in a project with none of its own — and
 * what it would run on. `undefined` while it loads or when the read failed:
 * callers then offer nothing rather than a choice that may not work.
 */
export function useStandardAgent(
  organizationId: string | undefined,
): StandardAgentAvailability | undefined {
  return useStandardAgentQuery(organizationId).data;
}

/** The read behind {@link useStandardAgent}, with its loading state and
 * refetch — for a surface that waits for the answer or retries it. */
export function useStandardAgentQuery(organizationId: string | undefined) {
  return useBackendQuery(
    'projects/queries:getStandardAgent',
    organizationId !== undefined ? { organizationId } : 'skip',
  );
}

export type ProjectOverviewRow =
  PageItemOf<'projects/queries:listProjectsOverview'>;

/**
 * How coarsely the overdue clock is quantized. `listProjectsOverview` counts
 * overdue against an `asOf` argument rather than the server's clock, so a
 * cached page says what it said when it was read. Rounding to a bucket gives
 * the cache key something that actually rotates, without refetching on every
 * render.
 */
const OVERDUE_BUCKET_MS = 5 * 60 * 1000;

/**
 * The ONE place the overview query's args are built. The route loader
 * prefetches with these and the hook subscribes with these, so the TanStack
 * Query cache key cannot drift between the two — a mismatch would silently
 * turn the prefetch into a wasted request and paint a skeleton.
 */
export function projectsOverviewArgs(
  organizationId: string,
  includeArchived: boolean,
) {
  return {
    organizationId,
    includeArchived,
    asOf: Math.floor(Date.now() / OVERDUE_BUCKET_MS) * OVERDUE_BUCKET_MS,
  };
}

/**
 * The projects LIST page's data, one page of projects at a time, newest
 * first, each with its at-a-glance rollups. Separate from `useProjects` — the
 * plain list is on the chat hot path and must not pay for these walks.
 *
 * `loadMore` asks for the next page; a failed read is the list's to show
 * (`error`, with `retry`), never "no projects yet" (2026-09-26 evaluation,
 * G-07).
 */
export function useProjectsOverview(
  organizationId: string,
  options: { includeArchived: boolean },
) {
  const listing = useCachedPaginatedQuery(
    'projects/queries:listProjectsOverview',
    projectsOverviewArgs(organizationId, options.includeArchived),
    { initialNumItems: PROJECTS_PAGE_SIZE },
  );
  return {
    ...listing,
    projects: listing.results,
    // The first page only: a later page loading keeps the rows on screen.
    isLoading: listing.status === 'LoadingFirstPage',
  };
}

/**
 * The organization's projects, with how the read stands (`readStateOf`): a
 * read that failed is no empty list, and never makes a project seem deleted
 * (#4605).
 */
export function useProjects(
  organizationId: string,
  options?: { includeArchived?: boolean },
) {
  const query = useBackendQuery('projects/queries:listProjects', {
    organizationId,
    includeArchived: options?.includeArchived,
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    projects: query.data ?? [],
    isLoading: query.isLoading,
    error: query.isError,
    isRetrying: query.isFetching,
    ...readStateOf(query),
    retry,
    // Whether the list has answered: a first read held back while the
    // browser is offline is not `isLoading`, and no empty list either.
    hasAnswer: query.data !== undefined,
  };
}

/** A project as a picker offers it and a screen names it. */
export type ProjectChoice = ItemOf<'projects/queries:searchProjects'>;

const NO_PROJECT_CHOICES: readonly ProjectChoice[] = [];

/**
 * What a project picker offers for what was typed — the project breadcrumb
 * switcher: Home's navigator page (the pinned first) and, while that page
 * does not hold every project, the server's name search for the typed text,
 * debounced — never the whole list {@link useProjects} reads, however many
 * projects the organization has (#5194). No archived project is offered.
 * The read stands as the page's does (`readStateOf`): a failed search offers
 * the page alone. `isDone` says whether the page holds every project.
 */
export function useProjectChoices(organizationId: string, query: string) {
  const page = useBackendQuery('projects/queries:listSidebarProjects', {
    organizationId,
    limit: NAVIGATOR_PROJECT_LIMIT,
  });
  const typed = useDebounce(query, PROJECT_SEARCH_DEBOUNCE_MS);
  const term = projectSearchTerm(typed, page.data?.isDone);
  const search = useBackendQuery(
    'projects/queries:searchProjects',
    term === null ? 'skip' : { organizationId, query: term },
    // The last term's hits stay while the next one loads; the picker's own
    // filter narrows them to what is typed.
    { placeholderData: keepPreviousData },
  );
  const rows = page.data?.projects;
  const found = term === null ? undefined : search.data;
  const projects = useMemo(
    () =>
      mergeProjectChoices(
        rows ?? NO_PROJECT_CHOICES,
        found ?? NO_PROJECT_CHOICES,
      ),
    [rows, found],
  );
  const { refetch } = page;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    projects,
    isDone: page.data?.isDone,
    isLoading: page.isLoading,
    error: page.isError,
    isRetrying: page.isFetching,
    ...readStateOf(page),
    retry,
  };
}

const NO_PROJECT_IDS: readonly string[] = [];

export interface NamedProjects {
  /** Each named project the caller can read, by id, archived ones too. One
   * that is gone, out of reach or whose read failed is absent. */
  projects: ReadonlyMap<string, ProjectChoice>;
  /** A named project is still being read. */
  isPending: boolean;
}

interface ProjectsById {
  rows: ProjectChoice[];
  isPending: boolean;
}

/**
 * The projects a screen names by id (the projects an automation is bound
 * to, the one a dialog targets), never the whole list {@link useProjects}
 * reads (#5204). Home's navigator page answers the ones it holds: the read
 * {@link useProjectChoices} makes, so a screen with both makes it once.
 * Each id the page lacks is read on its own, under the key the project's
 * own pages read it by. No ids, no read.
 */
export function useNamedProjects(
  organizationId: string,
  projectIds: readonly string[],
): NamedProjects {
  // The same ids, in any order, are the same reads.
  const signature = [...new Set(projectIds)].sort().join('\n');
  const page = useBackendQuery(
    'projects/queries:listSidebarProjects',
    signature === ''
      ? 'skip'
      : { organizationId, limit: NAVIGATOR_PROJECT_LIMIT },
  );
  const onPage = page.data?.projects;
  // A page that cannot be read names nothing: every id is read on its own.
  const pageSettled = onPage !== undefined || readStateOf(page).unavailable;
  const pastPage = useMemo(() => {
    if (signature === '' || !pageSettled) return NO_PROJECT_IDS;
    const listed = new Set((onPage ?? []).map((project) => project._id));
    return signature.split('\n').filter((id) => !listed.has(id));
  }, [signature, pageSettled, onPage]);
  const argsList = useMemo(
    () => pastPage.map((projectId) => ({ organizationId, projectId })),
    [pastPage, organizationId],
  );
  const combine = useCallback(
    (
      results: UseQueryResult<ReturnsOf<'projects/queries:getProject'>>[],
    ): ProjectsById => ({
      rows: results.flatMap((result) => (result.data ? [result.data] : [])),
      isPending: results.some((result) => result.isPending),
    }),
    [],
  );
  const byId = useBackendQueries(
    'projects/queries:getProject',
    argsList,
    combine,
  );
  return useMemo(() => {
    const named = new Set(signature === '' ? [] : signature.split('\n'));
    const projects = new Map<string, ProjectChoice>();
    for (const project of onPage ?? []) {
      if (named.has(project._id)) projects.set(project._id, project);
    }
    for (const project of byId.rows) projects.set(project._id, project);
    return {
      projects,
      isPending: signature !== '' && (!pageSettled || byId.isPending),
    };
  }, [signature, onPage, pageSettled, byId]);
}

/**
 * The project, with how its read stands (`readStateOf`). The read answers
 * `null` for a project that is gone or out of reach; a read that failed is
 * not that, and says so — never a project that seems deleted, never a blank
 * tab (#3885).
 */
export function useProject(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const query = useBackendQuery(
    'projects/queries:getProject',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    project: query.data ?? null,
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry,
  };
}

export type ProjectRead = Pick<
  ReturnType<typeof useProject>,
  'retrying' | 'failureCount' | 'retry'
>;

/**
 * A project list read's rows, with how the read stands (`readStateOf`): a
 * failed read is the screen's to name and retry, never an empty list
 * (#3736).
 */
function projectListRead<Row>(query: {
  data: Row[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  errorUpdateCount: number;
  refetch: () => Promise<unknown>;
}) {
  const { refetch } = query;
  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry: () => void refetch(),
  };
}

export function useProjectDocuments(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { rows, ...read } = projectListRead(
    useBackendQuery(
      'projects/queries:listProjectDocuments',
      projectId && organizationId ? { projectId, organizationId } : 'skip',
    ),
  );
  return { documents: rows, ...read };
}

export function useProjectFolders(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { rows, ...read } = projectListRead(
    useBackendQuery(
      'projects/queries:listProjectFolders',
      projectId && organizationId ? { projectId, organizationId } : 'skip',
    ),
  );
  return { folders: rows, ...read };
}

/** The Chats tab's data: the caller's own conversations in the project and
 * the ones other members shared with it, from the chat-v2 tables. */
export function useProjectChatThreads(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const query = useBackendQuery(
    'chat/project_threads:listThreadsForProject',
    projectId && organizationId
      ? { organizationId, projectId: projectId }
      : 'skip',
  );
  return {
    mine: query.data?.mine ?? [],
    shared: query.data?.shared ?? [],
    isLoading: query.isLoading,
    ...readStateOf(query),
    retry: () => void query.refetch(),
  };
}
