// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '@/app/features/projects/lib/project-choices';
import { render, screen, waitFor } from '@/tests/utils/render';

/**
 * The project bindings over more projects than Home's page holds (#5204):
 * what is typed is searched on the server, a project past the page can be
 * bound and stays named, and a bound project past the page is read by id.
 * The projects' hooks and adapter rows are real; `fetch` is stubbed,
 * answering like the backend, and the bound set and its save are stubbed
 * as in project-bindings-section.test.tsx.
 */
let boundData: string[] | undefined;
const setProjects = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../hooks/queries', () => ({
  useAutomationProjects: () => ({ data: boundData, isPending: false }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetAutomationProjects: () => setProjects,
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined
        ? `${ns}.${key}`
        : `${ns}.${key}:${JSON.stringify(params)}`,
  }),
}));

import { AutomationEditorActions } from './automation-editor-actions';
import { ProjectBindingsSection } from './project-bindings-section';

const PAGE_READ =
  '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1';

/** 120 projects; the page holds the first 100. */
const PROJECTS = Array.from({ length: 120 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
}));

let queryClient: QueryClient;
/** Every request, as path and query string. */
let gets: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function answer(url: URL): Response {
  if (url.pathname === '/api/app/projects/sidebar') {
    return json({ projects: PROJECTS.slice(0, 100), isDone: false });
  }
  if (url.pathname === '/api/app/projects/search') {
    const term = (url.searchParams.get('q') ?? '').toLowerCase();
    return json({
      projects: PROJECTS.filter((project) =>
        project.name.toLowerCase().includes(term),
      ).slice(0, 20),
    });
  }
  const id = /^\/api\/app\/projects\/([^/]+)$/.exec(url.pathname)?.[1];
  const project = PROJECTS.find((row) => row.id === id);
  if (project === undefined) return json({ error: 'NOT_FOUND' }, 404);
  return json({
    project: {
      ...project,
      organizationId: 'org-1',
      description: null,
      icon: null,
      color: null,
      key: null,
      externalItemId: null,
      taskCounter: 0,
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
      teamId: null,
      sharedWithTeamIds: [],
      teamIds: [],
      instructions: null,
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    },
  });
}

/** The General tab's frame: its sections join one Save/Discard cluster. */
function GeneralTab({ children }: { children: ReactNode }) {
  return (
    <ActiveEditorProvider>
      <AutomationEditorActions />
      <EditorGroup>{children}</EditorGroup>
    </ActiveEditorProvider>
  );
}

function renderSection() {
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralTab>
        <ProjectBindingsSection
          organizationId="org-1"
          name="desk/prepare-return"
          canEdit
        />
      </GeneralTab>
    </QueryClientProvider>,
  );
}

const saveButton = () =>
  screen.getByRole('button', { name: 'common.actions.save' });

/** The bound projects, in chip order: each chip carries a remove button. */
const chips = () =>
  screen
    .queryAllByRole('button', { name: /^Remove / })
    .map((button) =>
      button.getAttribute('aria-label')?.replace(/^Remove /, ''),
    );

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  setProjects.mutateAsync.mockReset();
  window.__ENV__ = { BASE_PATH: '' };
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    gets.push(`${url.pathname}${url.search}`);
    return Promise.resolve(answer(url));
  });
});

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('ProjectBindingsSection over more projects than a page', () => {
  it('names and offers a bound project past the page, read by id', async () => {
    boundData = ['p-3', 'p-120'];
    const { user } = renderSection();

    await waitFor(() => expect(chips()).toEqual(['Project 3', 'Project 120']));
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Project 120' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // The page, then the bound project it lacks: never the whole list.
    expect(gets).toEqual([PAGE_READ, '/api/app/projects/p-120?orgId=org-1']);
  });

  it('binds a project past the page through the server search, and keeps naming it', async () => {
    boundData = ['p-3'];
    setProjects.mutateAsync.mockResolvedValue(undefined);
    const { user } = renderSection();
    await waitFor(() => expect(chips()).toEqual(['Project 3']));

    await user.click(screen.getByRole('combobox'));
    expect(
      screen.queryByRole('option', { name: 'Project 115' }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole('combobox', {
        name: 'automations.bindings.searchPlaceholder',
      }),
      'Project 115',
    );
    await user.click(
      await screen.findByRole(
        'option',
        { name: 'Project 115' },
        { timeout: 2_000 },
      ),
    );
    await user.keyboard('{Escape}');

    // The search box reset on close, and past the debounce the search's hits
    // left the offer; the chip still names the pick.
    await new Promise((resolve) =>
      setTimeout(resolve, PROJECT_SEARCH_DEBOUNCE_MS + 100),
    );
    expect(chips()).toEqual(['Project 3', 'Project 115']);
    await user.click(saveButton());
    expect(setProjects.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: ['p-3', 'p-115'] }),
    );
    // The page and the search: never the whole list, no read by id.
    expect(gets).toEqual([
      PAGE_READ,
      '/api/app/projects/search?q=Project%20115&summary=true&orgId=org-1',
    ]);
  });
});
