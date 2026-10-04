import {
  ActiveEditorProvider,
  DirtyBlockerProvider,
  EditorActions,
  useActiveEditor,
} from '@tale/ui/editor';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { createContext, useContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { Route } from './overview';

const updateIdentity = vi.fn();
const updateInstructions = vi.fn();
const projects = {
  'project-a': {
    name: 'Project A',
    description: 'A description',
    instructions: 'A instructions',
    icon: 'Folder',
    color: 'gray',
    canEdit: true,
    canAdminister: false,
  },
  'project-b': {
    name: 'Project B',
    description: 'B description',
    instructions: 'B instructions',
    icon: 'Folder',
    color: 'blue',
    canEdit: true,
    canAdminister: false,
  },
};

const ProjectDataContext = createContext(projects);

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: (projectId: keyof typeof projects) => ({
    project: useContext(ProjectDataContext)[projectId],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/mutations', () => ({
  useUpdateProjectIdentity: () => ({ mutateAsync: updateIdentity }),
  useUpdateProjectInstructions: () => ({ mutateAsync: updateInstructions }),
}));

vi.mock('@/app/features/projects/components/project-sharing-section', () => ({
  ProjectSharingSection: () => null,
}));
vi.mock(
  '@/app/features/projects/components/project-task-reviewer-section',
  () => ({
    ProjectTaskReviewerSection: () => null,
  }),
);
vi.mock('@/app/features/projects/components/project-archive-section', () => ({
  ProjectArchiveSection: () => null,
}));
vi.mock('@/app/features/projects/components/project-danger-zone', () => ({
  ProjectDangerZone: () => null,
}));

const path = '/dashboard/$id/projects/$projectId/overview';

function OverviewLayout() {
  const editor = useActiveEditor();
  return (
    <>
      {editor && <EditorActions controller={editor} />}
      <Outlet />
    </>
  );
}

function renderOverview() {
  const root = createRootRoute({
    component: () => (
      <DirtyBlockerProvider>
        <ActiveEditorProvider>
          <OverviewLayout />
        </ActiveEditorProvider>
      </DirtyBlockerProvider>
    ),
  });
  const route = createRoute({
    getParentRoute: () => root,
    path,
    component: Route.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-1/projects/project-a/overview'],
    }),
  });
  const view = (data: typeof projects) => (
    <ProjectDataContext.Provider value={data}>
      <RouterProvider router={router} />
    </ProjectDataContext.Provider>
  );
  const result = render(view({ ...projects }));
  return {
    router,
    ...result,
    refreshProjects: () => result.rerender(view({ ...projects })),
  };
}

const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const descriptionField = () =>
  screen.getByRole('textbox', { name: 'Description' });
const instructionsField = () =>
  screen.getByRole('textbox', { name: 'Instructions' });

async function expectProjectB() {
  await waitFor(() => expect(nameField()).toHaveValue('Project B'));
  expect(descriptionField()).toHaveValue('B description');
  expect(instructionsField()).toHaveValue('B instructions');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(updateIdentity).not.toHaveBeenCalled();
  expect(updateInstructions).not.toHaveBeenCalled();
}

describe('project overview navigation identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateIdentity.mockResolvedValue(undefined);
    updateInstructions.mockResolvedValue(undefined);
    projects['project-a'].name = 'Project A';
    projects['project-a'].description = 'A description';
  });

  it('discards A drafts and saves only B values after leaving through the blocker', async () => {
    const { router, user } = renderOverview();
    await screen.findByDisplayValue('Project A');
    fireEvent.change(nameField(), { target: { value: 'UNSAVED A NAME' } });
    fireEvent.change(instructionsField(), {
      target: { value: 'UNSAVED A INSTRUCTIONS' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );

    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = router.navigate({
        to: path,
        params: { id: 'org-1', projectId: 'project-b' },
      });
    });
    await screen.findByRole('dialog');
    expect(router.state.location.pathname).toContain('/project-a/');
    expect(screen.getByDisplayValue('UNSAVED A NAME')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard & Leave' }));
    await act(async () => navigation);
    expect(router.state.location.pathname).toContain('/project-b/');
    await expectProjectB();

    fireEvent.change(descriptionField(), {
      target: { value: 'Edited B description' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateIdentity).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-b',
        name: 'Project B',
        description: 'Edited B description',
        icon: 'Folder',
        color: 'blue',
      }),
    );
    expect(updateInstructions).not.toHaveBeenCalled();
  });

  it('adopts B saved values without a dialog or write on clean navigation', async () => {
    const { router } = renderOverview();
    await screen.findByDisplayValue('Project A');
    await act(() =>
      router.navigate({
        to: path,
        params: { id: 'org-1', projectId: 'project-b' },
      }),
    );
    await expectProjectB();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps A draft and location when the user chooses Stay', async () => {
    const { router, user } = renderOverview();
    await screen.findByDisplayValue('Project A');
    fireEvent.change(nameField(), { target: { value: 'UNSAVED A NAME' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await act(async () => {
      void router.navigate({
        to: path,
        params: { id: 'org-1', projectId: 'project-b' },
      });
    });
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toContain('/project-a/');
    expect(nameField()).toHaveValue('UNSAVED A NAME');
    expect(descriptionField()).toHaveValue('A description');
    expect(updateIdentity).not.toHaveBeenCalled();
  });

  it('preserves a dirty draft on a same-project remote update', async () => {
    const { refreshProjects } = renderOverview();
    await screen.findByDisplayValue('Project A');
    fireEvent.change(nameField(), { target: { value: 'UNSAVED A NAME' } });
    projects['project-a'] = {
      ...projects['project-a'],
      name: 'Remote A name',
      description: 'Remote A description',
    };
    refreshProjects();
    expect(nameField()).toHaveValue('UNSAVED A NAME');
    expect(descriptionField()).toHaveValue('A description');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(updateIdentity).not.toHaveBeenCalled();
  });

  it('adopts a same-project remote update while clean', async () => {
    const { refreshProjects } = renderOverview();
    await screen.findByDisplayValue('Project A');
    projects['project-a'] = {
      ...projects['project-a'],
      name: 'Remote A name',
      description: 'Remote A description',
    };
    refreshProjects();
    await screen.findByDisplayValue('Remote A name');
    expect(descriptionField()).toHaveValue('Remote A description');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateIdentity).not.toHaveBeenCalled();
  });

  it('discards drafts when the organization changes with the same project parameter', async () => {
    const { router, user } = renderOverview();
    await screen.findByDisplayValue('Project A');
    fireEvent.change(nameField(), { target: { value: 'UNSAVED A NAME' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = router.navigate({
        to: path,
        params: { id: 'org-2', projectId: 'project-a' },
      });
    });
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Discard & Leave' }));
    await act(async () => navigation);
    expect(router.state.location.pathname).toContain('/org-2/');
    await screen.findByDisplayValue('Project A');
    expect(descriptionField()).toHaveValue('A description');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateIdentity).not.toHaveBeenCalled();
  });
});
