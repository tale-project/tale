import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ProjectBreadcrumbSwitcher } from '@/app/features/projects/components/project-breadcrumb-switcher';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Route } from './files';

// #3918: the project breadcrumb keeps the Files tab on a project switch, and
// the tab used to keep the previous project's upload folder with it, in its
// state and in `?folderId=`. The next project's tab read "Add file" with no
// folder selected, yet its upload named the other project's folder, which
// the server refuses. The Files route, the switcher, the tab and the router
// run for real; the reads, the writes and the blob door are stubbed seams.

type FolderFixture = { _id: string; name: string; parentId?: string };

const PROJECTS = [
  { _id: 'project-a', name: 'Project Alpha' },
  { _id: 'project-b', name: 'Project Bravo' },
];
const ALPHA: FolderFixture = { _id: 'folder-a', name: 'Folder Alpha' };
const BRAVO: FolderFixture = { _id: 'folder-b', name: 'Folder Bravo' };

let foldersByProject: Record<string, FolderFixture[]> = {};

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: PROJECTS, isLoading: false }),
  useProject: () => ({ project: { canEdit: true }, isLoading: false }),
  useProjectDocuments: () => ({ documents: [], isLoading: false }),
  useProjectFolders: (projectId: string) => ({
    folders: foldersByProject[projectId] ?? [],
    isLoading: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/mutations', () => ({
  useDetachDocumentFromProject: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/documents/hooks/mutations', () => ({
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutateAsync: vi.fn() }),
  useCreateFolder: () => ({ mutateAsync: vi.fn() }),
  useMarkDocumentControlled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenRecordRevision: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRecordForReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRespondToDocumentRecordReview: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/features/documents/hooks/queries', () => ({
  useDocumentByExternalItemId: () => ({ data: undefined, isLoading: false }),
  useDocumentVersions: () => ({ data: undefined, isLoading: false }),
  usePendingDocumentRecordReview: () => ({ data: undefined }),
  useEligibleDocumentReviewerIds: () => ({ data: [] }),
  useLastDocumentRecordReview: () => ({ data: undefined }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
  useUploadPolicy: () => ({}),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The upload's two writes: the blob door's address, then the document row
// whose `projectId` and `folderId` are the destination under test.
const createDocumentFromUpload = vi.fn();
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'documents/mutations:createDocumentFromUpload'
        ? createDocumentFromUpload
        : vi.fn().mockResolvedValue('https://blob.test/upload'),
  }),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));

/** The project page's frame: its breadcrumb switcher above the open tab. */
function ProjectShell() {
  const { id = '', projectId = '' } = useParams({ strict: false });
  const project = PROJECTS.find((row) => row._id === projectId);
  return (
    <>
      <ProjectBreadcrumbSwitcher
        organizationId={id}
        projectId={projectId}
        projectName={project?.name ?? ''}
      />
      <Outlet />
    </>
  );
}

function renderFiles(initialEntry: string) {
  const root = createRootRoute({ component: Outlet });
  const project = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id/projects/$projectId',
    component: ProjectShell,
  });
  const files = createRoute({
    getParentRoute: () => project,
    path: '/files',
    validateSearch: Route.options.validateSearch,
    component: Route.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([project.addChildren([files])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

type Rendered = ReturnType<typeof renderFiles>;

const folderRow = (name: string) => screen.findByRole('button', { name });
const selectedRows = () =>
  screen
    .queryAllByRole('button')
    .filter((button) => button.getAttribute('aria-current') === 'true');

async function switchProject(
  { user, router }: Rendered,
  from: string,
  to: string,
) {
  await user.click(
    screen.getByRole('button', { name: `Switch project, current: ${from}` }),
  );
  await user.click(await screen.findByRole('option', { name: to }));
  const target = PROJECTS.find((row) => row.name === to)?._id;
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(
      `/dashboard/org-1/projects/${target}/files`,
    );
  });
  await screen.findByRole('button', {
    name: `Switch project, current: ${to}`,
  });
}

async function uploadOneFile({ user }: Rendered) {
  const input = document.getElementById('project-files-upload');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  await user.upload(
    input,
    new File(['synthetic'], 'new-upload.txt', { type: 'text/plain' }),
  );
  await waitFor(() => {
    expect(createDocumentFromUpload).toHaveBeenCalledTimes(1);
  });
  return createDocumentFromUpload.mock.calls[0]?.[0];
}

beforeAll(async () => {
  // The application loader warms this chunk before the tab renders.
  await import('@/app/features/projects/components/project-files-tab');
});

beforeEach(() => {
  foldersByProject = { 'project-a': [ALPHA], 'project-b': [] };
  createDocumentFromUpload.mockResolvedValue('doc-new');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ storageId: 'storage-new' }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('Files route — a project switch', () => {
  it.each([
    { bravo: 'empty', folders: [] },
    { bravo: 'with its own folder', folders: [BRAVO] },
  ])(
    'uploads to the root of the project switched to ($bravo)',
    async ({ folders }) => {
      foldersByProject['project-b'] = folders;
      const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

      await rendered.user.click(await folderRow('Folder Alpha'));
      expect(
        await screen.findByText('Add file to "Folder Alpha"'),
      ).toBeInTheDocument();

      await switchProject(rendered, 'Project Alpha', 'Project Bravo');

      expect(screen.queryByText(/Add file to/)).not.toBeInTheDocument();
      expect(selectedRows()).toEqual([]);
      const upload = await uploadOneFile(rendered);
      expect(upload).toEqual(
        expect.objectContaining({ projectId: 'project-b' }),
      );
      expect(upload?.folderId).toBeUndefined();
    },
  );

  it("leaves the previous project's folder out of the address", async () => {
    const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

    await rendered.user.click(await folderRow('Folder Alpha'));
    await waitFor(() => {
      expect(rendered.router.state.location.search).toEqual({
        folderId: 'folder-a',
      });
    });

    await switchProject(rendered, 'Project Alpha', 'Project Bravo');

    expect(rendered.router.state.location.search).toEqual({});
  });
});

describe('Files route — controls', () => {
  it('uploads to the root of a project opened fresh', async () => {
    const rendered = renderFiles('/dashboard/org-1/projects/project-b/files');
    await screen.findByRole('button', {
      name: 'Switch project, current: Project Bravo',
    });

    const upload = await uploadOneFile(rendered);
    expect(upload).toEqual(expect.objectContaining({ projectId: 'project-b' }));
    expect(upload?.folderId).toBeUndefined();
  });

  it('uploads to a folder picked in the project on screen', async () => {
    const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

    await rendered.user.click(await folderRow('Folder Alpha'));

    expect(await uploadOneFile(rendered)).toEqual(
      expect.objectContaining({ projectId: 'project-a', folderId: 'folder-a' }),
    );
  });

  it("opens on the project's own folder from its address", async () => {
    const rendered = renderFiles(
      '/dashboard/org-1/projects/project-a/files?folderId=folder-a',
    );

    expect(await folderRow('Folder Alpha')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Folder Alpha' }),
      ).toHaveAttribute('aria-current', 'true');
    });
    expect(screen.getByText('Add file to "Folder Alpha"')).toBeInTheDocument();
    await checkAccessibility(
      screen.getByRole('list', { name: 'Project files' }),
    );
    expect(await uploadOneFile(rendered)).toEqual(
      expect.objectContaining({ projectId: 'project-a', folderId: 'folder-a' }),
    );
  });
});
