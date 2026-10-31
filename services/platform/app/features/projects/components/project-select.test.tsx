import type { SearchableSelectOption } from '@tale/ui/searchable-select';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { PROJECT_SEARCH_DEBOUNCE_MS } from '../lib/project-choices';
import { ProjectSelect } from './project-select';

/**
 * A project field over more projects than Home's page holds (#5204): what
 * is typed is searched on the server, and a project past the page can be
 * picked and stays named. Real hooks and adapter rows; only `fetch` is
 * stubbed, answering like the backend.
 */

/** 120 projects; the page holds the first 100. */
const PROJECTS = Array.from({ length: 120 }, (_, index) => ({
  id: `p-${index + 1}`,
  name: `Project ${index + 1}`,
}));

const ORGANIZATION: readonly SearchableSelectOption[] = [
  { value: 'organization', label: 'The whole organization' },
];

let queryClient: QueryClient;
/** Every request, as path and query string. */
let gets: string[] = [];
/** How many projects Home's page holds, and whether that is all of them. */
let page = { size: 100, isDone: false };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function answer(url: URL): Response {
  if (url.pathname === '/api/app/projects/sidebar') {
    return json({
      projects: PROJECTS.slice(0, page.size),
      isDone: page.isDone,
    });
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

function Field({
  initial,
  onPick,
  leadingOptions,
}: {
  initial: string | null;
  onPick: (value: string) => void;
  leadingOptions?: readonly SearchableSelectOption[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProjectSelect
      organizationId="org-1"
      id="project-field"
      label="Project"
      placeholder="Choose a project"
      searchPlaceholder="Search projects"
      emptyText="No projects"
      value={value}
      {...(leadingOptions !== undefined && { leadingOptions })}
      onValueChange={(next) => {
        setValue(next);
        onPick(next);
      }}
    />
  );
}

function renderField(props: Parameters<typeof Field>[0]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Field {...props} />
    </QueryClientProvider>,
  );
}

/** The field's trigger, which shows the picked project's name. */
function trigger() {
  const button = document.getElementById('project-field');
  if (button === null) throw new Error('the field has no trigger');
  return button;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  gets = [];
  page = { size: 100, isDone: false };
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

describe('ProjectSelect', () => {
  it('picks a project past the page through the server search, and keeps naming it', async () => {
    const onPick = vi.fn();
    const { user } = renderField({ initial: null, onPick });
    await waitFor(() => expect(gets).toHaveLength(1));

    await user.click(trigger());
    expect(
      await screen.findByRole('option', { name: 'Project 100' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Project 115' }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'Project 115');
    await user.click(
      await screen.findByRole(
        'option',
        { name: 'Project 115' },
        { timeout: 2_000 },
      ),
    );

    expect(onPick).toHaveBeenCalledWith('p-115');
    // The search box reset on close, and past the debounce the search's hits
    // left the offer; the field still names the pick.
    await new Promise((resolve) =>
      setTimeout(resolve, PROJECT_SEARCH_DEBOUNCE_MS + 100),
    );
    expect(trigger()).toHaveTextContent('Project 115');
    // The page and the search: never the whole list, no read by id.
    expect(gets).toEqual([
      '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1',
      '/api/app/projects/search?q=Project%20115&summary=true&orgId=org-1',
    ]);
  });

  it('names a selected project past the page, read by id', async () => {
    renderField({ initial: 'p-120', onPick: vi.fn() });

    await waitFor(() => expect(trigger()).toHaveTextContent('Project 120'));
    expect(gets).toEqual([
      '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1',
      '/api/app/projects/p-120?orgId=org-1',
    ]);
  });

  it('offers its leading options above the projects, without a read by id', async () => {
    // A short page: a list of more than 100 rows renders a window of them.
    page = { size: 3, isDone: true };
    const onPick = vi.fn();
    const { user } = renderField({
      initial: 'organization',
      onPick,
      leadingOptions: ORGANIZATION,
    });
    expect(trigger()).toHaveTextContent('The whole organization');

    await user.click(trigger());
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('The whole organization');
    expect(options[1]).toHaveTextContent('Project 1');

    await user.click(screen.getByRole('option', { name: 'Project 2' }));
    expect(onPick).toHaveBeenCalledWith('p-2');
    await waitFor(() => expect(trigger()).toHaveTextContent('Project 2'));
    expect(gets).toEqual([
      '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1',
    ]);
  });
});
