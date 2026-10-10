import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
  useRouterState,
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
import { AppError } from '@/lib/shared/errors/app-error';
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import '@/app/globals.css';

import { Route } from './files';

// The first render waits on cold module transforms.
configure({ asyncUtilTimeout: 10_000 });

// #3917 and #3918 in Chromium: the Files route, the breadcrumb switcher, the
// tab, its tree and confirmation, the toaster and the router run for real.
// The reads, the writes and the blob door are stubbed seams; the upload's
// write answers as the server's folder check does (DOC-R13): a folder that
// is not one of the project's own is not found.

type FolderFixture = { _id: string; name: string; parentId?: string };

const PROJECTS = [
  { _id: 'project-a', name: 'Project Alpha' },
  { _id: 'project-b', name: 'Project Bravo' },
];
const ALPHA: FolderFixture = { _id: 'folder-a', name: 'Folder Alpha' };
const BRAVO: FolderFixture = { _id: 'folder-b', name: 'Folder Bravo' };

const mocks = vi.hoisted(() => {
  const none: FolderFixture[] = [];
  let byProject: Record<string, FolderFixture[]> = {};
  const listeners = new Set<() => void>();
  return {
    /** The folder reads, answered again when a write changes them. */
    folders: {
      of: (projectId: string) => byProject[projectId] ?? none,
      set: (next: Record<string, FolderFixture[]>) => {
        byProject = next;
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    deleteFolder: vi.fn(),
    createDocumentFromUpload: vi.fn(),
  };
});

// Chromium links real ES modules, so each stubbed module keeps its other
// exports: the tab's tree imports more of them than it calls here.
vi.mock('@/app/features/projects/hooks/queries', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await importOriginal<
      typeof import('@/app/features/projects/hooks/queries')
    >()),
    useProjects: () => ({ projects: PROJECTS, isLoading: false }),
    useProject: () => ({ project: { canEdit: true }, isLoading: false }),
    useProjectDocuments: () => ({ documents: [], isLoading: false }),
    useProjectFolders: (projectId: string) => ({
      folders: useSyncExternalStore(mocks.folders.subscribe, () =>
        mocks.folders.of(projectId),
      ),
      isLoading: false,
    }),
  };
});

vi.mock('@/app/features/projects/hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/projects/hooks/mutations')
  >()),
  useDetachDocumentFromProject: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/features/documents/hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/documents/hooks/mutations')
  >()),
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFolder: () => ({ mutateAsync: mocks.deleteFolder }),
  useCreateFolder: () => ({ mutateAsync: vi.fn() }),
  useMarkDocumentControlled: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenRecordRevision: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSubmitRecordForReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRespondToDocumentRecordReview: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/features/documents/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/documents/hooks/queries')
  >()),
  useDocumentByExternalItemId: () => ({ data: undefined, isLoading: false }),
  useDocumentVersions: () => ({ data: undefined, isLoading: false }),
  usePendingDocumentRecordReview: () => ({ data: undefined }),
  useEligibleDocumentReviewerIds: () => ({ data: [] }),
  useLastDocumentRecordReview: () => ({ data: undefined }),
}));

vi.mock(
  '@/app/features/settings/organization/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/organization/hooks/queries')
    >()),
    useMembers: () => ({ members: [] }),
  }),
);

vi.mock(
  '@/app/features/settings/governance/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/governance/hooks/queries')
    >()),
    useLegalHoldByTarget: () => ({ data: null }),
    useUploadPolicy: () => ({}),
  }),
);

vi.mock('@/app/hooks/use-organization-id', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-organization-id')>()),
  useOrganizationId: () => 'org-1',
}));

// The upload's two writes: the blob door's address, then the document row.
vi.mock('@/app/hooks/use-backend-mutation', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/hooks/use-backend-mutation')
  >()),
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'documents/mutations:createDocumentFromUpload'
        ? mocks.createDocumentFromUpload
        : vi.fn().mockResolvedValue('https://blob.test/upload'),
  }),
}));

vi.mock('@/app/hooks/use-backend-action', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-backend-action')>()),
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));

// The real toast, recorded: each test reads its own calls, and the toaster
// shows what the tab said.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

vi.mock(
  '@/app/features/documents/components/document-preview-dialog',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/documents/components/document-preview-dialog')
    >()),
    DocumentPreviewDialog: () => null,
  }),
);

/** The project page's frame: its breadcrumb switcher, the open tab, then
 * the address the router holds (a failure screenshot shows it). */
function ProjectShell() {
  const { id = '', projectId = '' } = useParams({ strict: false });
  const address = useRouterState({ select: (state) => state.location.href });
  const project = PROJECTS.find((row) => row._id === projectId);
  return (
    <div className="flex flex-col gap-4 p-6">
      <ProjectBreadcrumbSwitcher
        organizationId={id}
        projectId={projectId}
        projectName={project?.name ?? ''}
      />
      <Outlet />
      <output aria-label="Address" className="font-mono text-xs">
        {address}
      </output>
    </div>
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
  return {
    router,
    ...render(
      <>
        <RouterProvider router={router} />
        <Toaster />
      </>,
    ),
  };
}

type Rendered = ReturnType<typeof renderFiles>;

const folderRow = (name: string) => screen.findByRole('button', { name });

/** A delete the test answers when it chooses. */
function heldDelete() {
  let succeed = () => {};
  let fail = (_error: unknown) => {};
  mocks.deleteFolder.mockReturnValueOnce(
    new Promise<void>((resolve, reject) => {
      succeed = () => resolve();
      fail = reject;
    }),
  );
  return { succeed: () => succeed(), fail: (error: unknown) => fail(error) };
}

async function confirmDelete({ user }: Rendered, name: string) {
  const row = (await folderRow(name)).closest('li');
  if (!row) throw new Error(`no tree row for ${name}`);
  const [deleteAction] = within(row).getAllByRole('button', {
    name: 'Delete folder',
  });
  if (!deleteAction) throw new Error(`no Delete folder on ${name}`);
  await user.click(deleteAction);
  const dialog = await screen.findByRole('dialog', { name: 'Delete folder' });
  await user.click(
    within(dialog).getByRole('button', { name: 'Delete folder' }),
  );
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

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

/** Uploads one file and answers the tab's summary toast. */
async function uploadOneFile({ user }: Rendered) {
  const input = document.getElementById('project-files-upload');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  await user.upload(
    input,
    new File(['synthetic'], 'new-upload.txt', { type: 'text/plain' }),
  );
  await waitFor(() => {
    expect(mocks.createDocumentFromUpload).toHaveBeenCalledTimes(1);
  });
  return mocks.createDocumentFromUpload.mock.calls[0]?.[0];
}

const addressOf = ({ router }: Rendered) => router.state.location;

beforeAll(async () => {
  // The application loader warms this chunk before the tab renders.
  await import('@/app/features/projects/components/project-files-tab');
});

const realFetch = globalThis.fetch;

beforeEach(() => {
  mocks.folders.set({ 'project-a': [ALPHA, BRAVO], 'project-b': [] });
  mocks.createDocumentFromUpload.mockImplementation(
    async (args: { projectId: string; folderId?: string }) => {
      const own = mocks.folders.of(args.projectId);
      if (
        args.folderId !== undefined &&
        !own.some((folder) => folder._id === args.folderId)
      ) {
        throw new AppError({ code: 'FOLDER_NOT_FOUND' });
      }
      return 'doc-new';
    },
  );
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith('https://blob.test/')
      ? Promise.resolve(Response.json({ storageId: 'storage-new' }))
      : realFetch(input, init);
  });
});

afterEach(() => {
  cleanup();
  // The toaster's store outlives a test: close what this one raised.
  for (const result of vi.mocked(toast).mock.results) {
    if (result.type === 'return') result.value.dismiss();
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const added = { title: 'Document added to project', description: '1 / 1' };

describe('Files route in Chromium — a folder delete that answers late (#3917)', () => {
  it('keeps the folder picked while the delete was pending as the upload target', async () => {
    const remove = heldDelete();
    const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

    await rendered.user.click(await folderRow('Folder Alpha'));
    await confirmDelete(rendered, 'Folder Alpha');
    expect(mocks.deleteFolder).toHaveBeenCalledWith({ folderId: 'folder-a' });

    await rendered.user.click(await folderRow('Folder Bravo'));
    await waitFor(() => {
      expect(addressOf(rendered).search).toEqual({ folderId: 'folder-b' });
    });

    remove.succeed();
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Folder deleted' }),
      );
    });
    mocks.folders.set({ 'project-a': [BRAVO], 'project-b': [] });
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Folder Alpha' }),
      ).not.toBeInTheDocument();
    });

    expect(await folderRow('Folder Bravo')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(addressOf(rendered).search).toEqual({ folderId: 'folder-b' });
    expect(screen.getByText('Add file to "Folder Bravo"')).toBeVisible();
    expect(await uploadOneFile(rendered)).toEqual(
      expect.objectContaining({ projectId: 'project-a', folderId: 'folder-b' }),
    );
    await waitFor(() => {
      expect(toast).toHaveBeenLastCalledWith(expect.objectContaining(added));
    });
  });

  it('keeps the newer pick and says so when the delete is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const remove = heldDelete();
    const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

    await rendered.user.click(await folderRow('Folder Alpha'));
    await confirmDelete(rendered, 'Folder Alpha');
    await rendered.user.click(await folderRow('Folder Bravo'));
    remove.fail(new Error('synthetic refusal'));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't delete the folder",
          variant: 'destructive',
        }),
      );
    });
    expect(await folderRow('Folder Alpha')).toBeVisible();
    expect(await folderRow('Folder Bravo')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(addressOf(rendered).search).toEqual({ folderId: 'folder-b' });
  });
});

describe('Files route in Chromium — a project switch (#3918)', () => {
  it('uploads to the root of an empty project switched to', async () => {
    const rendered = renderFiles('/dashboard/org-1/projects/project-a/files');

    await rendered.user.click(await folderRow('Folder Alpha'));
    expect(await screen.findByText('Add file to "Folder Alpha"')).toBeVisible();

    await switchProject(rendered, 'Project Alpha', 'Project Bravo');

    expect(screen.getByText('Add file')).toBeVisible();
    const upload = await uploadOneFile(rendered);
    // The summary says where it went: a folder of the other project would
    // read as the server's refusal.
    await waitFor(() => {
      expect(toast).toHaveBeenCalled();
    });
    expect(upload).toEqual(expect.objectContaining({ projectId: 'project-b' }));
    expect(upload?.folderId).toBeUndefined();
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining(added));
    expect(addressOf(rendered).search).toEqual({});
  });

  it('uploads to the root of a project opened fresh', async () => {
    const rendered = renderFiles('/dashboard/org-1/projects/project-b/files');
    await screen.findByRole('button', {
      name: 'Switch project, current: Project Bravo',
    });

    const upload = await uploadOneFile(rendered);
    expect(upload).toEqual(expect.objectContaining({ projectId: 'project-b' }));
    expect(upload?.folderId).toBeUndefined();
    await waitFor(() => {
      expect(toast).toHaveBeenLastCalledWith(expect.objectContaining(added));
    });
  });
});
