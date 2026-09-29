import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProjectFilesTab } from './project-files-tab';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3736: a project whose folder read failed hid every file inside a folder,
// though the file read had succeeded. The two reads run for real here (the
// project hooks, their adapter rows, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport; what else the tab consults
// (the project record, policy, record menus, dialogs) is stubbed.

let canEdit = false;
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useProject: () => ({ project: { canEdit }, isLoading: false }),
}));
vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
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
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));
vi.mock('@/app/features/documents/components/document-history-dialog', () => ({
  DocumentHistoryDialog: () => null,
}));

const docsOf = (project: string) =>
  new RegExp(`^GET /api/app/documents/by-project/${project}\\?orgId=org-1$`);
const foldersOf = (project: string) =>
  new RegExp(`^GET /api/app/folders\\?projectId=${project}&orgId=org-1$`);

function folder(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    organizationId: 'org-1',
    name,
    parentId,
    teamId: null,
    teamTags: [],
    projectId: 'proj-a',
    createdBy: 'user-1',
    createdAt: 1789450000000,
  };
}
function doc(id: string, name: string, folderId?: string) {
  return {
    id,
    name,
    type: 'file',
    fileId: `blob-${id}`,
    mimeType: 'text/plain',
    extension: 'txt',
    ragStatus: 'completed',
    uploadedAt: 1789450000000,
    ...(folderId !== undefined ? { folderId } : {}),
  };
}

const FOLDERS = [
  folder('f-contracts', 'Contracts'),
  folder('f-2026', '2026', 'f-contracts'),
];
const DOCS = [
  doc('d-root', 'root-notes.txt'),
  doc('d-nested', 'contract-a.txt', 'f-contracts'),
  doc('d-deep', 'deep-b.txt', 'f-2026'),
];

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  canEdit = false;
  window.history.replaceState({}, '', '/dashboard/org-1/projects/proj-a/files');
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTab(projectId = 'proj-a', initialFolderId?: string) {
  const tab = (id: string) => (
    <QueryClientProvider client={client}>
      <ProjectFilesTab
        organizationId="org-1"
        projectId={id}
        initialFolderId={initialFolderId}
      />
    </QueryClientProvider>
  );
  const rendered = render(tab(projectId));
  return {
    ...rendered,
    showProject: (id: string) => rendered.rerender(tab(id)),
  };
}

const t = (key: string) => i18n.t(key, { ns: 'projects' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const tree = () => screen.getByRole('list', { name: t('files.treeLabel') });

describe('ProjectFilesTab when a tree read fails', { timeout: 30_000 }, () => {
  it('shows the root file, the folder and its nested file when both reads succeed', async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    renderTab('proj-a', 'f-contracts');

    expect(
      await screen.findByRole('button', { name: 'contract-a.txt' }),
    ).toBeInTheDocument();
    expect(
      within(tree()).getByRole('button', { name: 'Contracts' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(tree()).getByRole('button', { name: 'root-notes.txt' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the files it loaded — nested ones too — when the folder read fails, and recovers on Retry', async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
    backend.on(foldersOf('proj-a'), () => serviceUnavailable());
    const { user } = renderTab('proj-a', 'f-contracts');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('files.foldersLoadFailed'));
    expect(backend.count(foldersOf('proj-a'))).toBe(4);
    // Every loaded file stays reachable; the nested ones are grouped as
    // files inside folders rather than dropped.
    expect(
      within(tree()).getByRole('button', { name: 'root-notes.txt' }),
    ).toBeVisible();
    const inFolders = within(tree()).getByRole('list', {
      name: t('files.unplacedGroup'),
    });
    expect(
      within(inFolders).getByRole('button', { name: 'contract-a.txt' }),
    ).toBeVisible();
    expect(
      within(inFolders).getByRole('button', { name: 'deep-b.txt' }),
    ).toBeVisible();
    expect(screen.queryByText(t('files.emptyTitle'))).not.toBeInTheDocument();

    // Retry reads the folders again; the files come from the same cache.
    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    expect(
      await within(tree()).findByRole('button', { name: 'Contracts' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(tree()).getByRole('button', { name: 'contract-a.txt' }),
    ).toBeVisible();
    expect(
      within(tree()).queryByRole('list', { name: t('files.unplacedGroup') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.count(docsOf('proj-a'))).toBe(1);
  });

  it('never shows an empty list when every file is nested and the folder read fails', async () => {
    backend.on(docsOf('proj-a'), () =>
      Response.json({
        documents: [doc('d-only', 'nested-only.txt', 'f-inbox')],
      }),
    );
    backend.on(foldersOf('proj-a'), () => serviceUnavailable());
    renderTab();

    await screen.findByRole('alert');
    expect(
      within(tree()).getByRole('button', { name: 'nested-only.txt' }),
    ).toBeVisible();
  });

  it('says a project with no files is empty only when both reads succeeded', async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: [] }));
    backend.on(foldersOf('proj-a'), () => Response.json({ folders: [] }));
    renderTab();

    expect(await screen.findByText(t('files.emptyTitle'))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed file read as a failure, not as an empty project', async () => {
    backend.on(docsOf('proj-a'), () => serviceUnavailable());
    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    renderTab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('files.loadFailed'));
    expect(backend.count(docsOf('proj-a'))).toBe(4);
    expect(screen.queryByText(t('files.emptyTitle'))).not.toBeInTheDocument();
    expect(
      within(tree()).getByRole('button', { name: 'Contracts' }),
    ).toBeVisible();
  });

  it('keeps the loaded tree through a failed refresh, with a retry', async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    const { user } = renderTab('proj-a', 'f-contracts');
    await screen.findByRole('button', { name: 'contract-a.txt' });

    backend.on(foldersOf('proj-a'), () => serviceUnavailable());
    void client.invalidateQueries();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('files.refreshFailed'));
    expect(
      within(tree()).getByRole('button', { name: 'contract-a.txt' }),
    ).toBeVisible();

    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(
      within(tree()).getByRole('button', { name: 'Contracts' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it("keeps a retry's answer to its own project when the tab moves on", async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
    backend.on(foldersOf('proj-a'), () => serviceUnavailable());
    backend.on(docsOf('proj-b'), () =>
      Response.json({ documents: [doc('d-b', 'other-project.txt')] }),
    );
    backend.on(foldersOf('proj-b'), () => Response.json({ folders: [] }));
    const { user, showProject } = renderTab('proj-a');
    const alert = await screen.findByRole('alert');

    let answer: (response: Response) => void = () => {};
    backend.on(
      foldersOf('proj-a'),
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    await user.click(within(alert).getByRole('button', { name: tryAgain() }));
    showProject('proj-b');
    expect(
      await screen.findByRole('button', { name: 'other-project.txt' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    answer(Response.json({ folders: FOLDERS }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      within(tree()).queryByRole('button', { name: 'Contracts' }),
    ).toBeNull();
    expect(
      within(tree()).getByRole('button', { name: 'other-project.txt' }),
    ).toBeVisible();
  });

  // #3814 review: the same keyed-notice focus loss, swept here.
  it('keeps a focused Try again focused through another failed read, and hands focus to the files once they load', async () => {
    backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
    backend.on(foldersOf('proj-a'), () => serviceUnavailable());
    renderTab('proj-a', 'f-contracts');
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: tryAgain() });
    retry.focus();

    void client.invalidateQueries();
    await waitFor(() => expect(backend.count(foldersOf('proj-a'))).toBe(8));
    await waitFor(() =>
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).not.toHaveAttribute('aria-busy'),
    );
    expect(screen.getByRole('alert')).toBe(alert);
    expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(retry);
    expect(retry).toHaveFocus();

    backend.on(foldersOf('proj-a'), () => Response.json({ folders: FOLDERS }));
    void client.invalidateQueries();
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('group', { name: t('files.title') }),
      ).toHaveFocus(),
    );
  });

  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    it('names the failed folder read and its retry in the reader language', async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      backend.on(docsOf('proj-a'), () => Response.json({ documents: DOCS }));
      backend.on(foldersOf('proj-a'), () => serviceUnavailable());
      renderTab();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(t('files.foldersLoadFailed'));
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      expect(t('files.foldersLoadFailed')).not.toBe('files.foldersLoadFailed');
      expect(
        within(tree()).getByRole('list', { name: t('files.unplacedGroup') }),
      ).toBeInTheDocument();
    });
  });
});
