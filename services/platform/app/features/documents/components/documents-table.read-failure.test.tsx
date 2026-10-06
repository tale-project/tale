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

import { DocumentsTable } from './documents-table';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// The Documents table lists a level's folders beside its documents, from two
// reads. When the documents read failed, the folders alone passed for the
// whole library — "Showing all 2 documents", no failure named, no retry —
// against `KNOW-F25`. The read lane runs for real here (the paginated hook,
// the adapters, `backendFetch` and the four-attempt retry policy) against a
// closed synthetic transport that fails only the documents read.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// A stable navigate, as the router's own is: a new function per render
// would rebuild the columns, and remount every row's menu and dialog.
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
  useLocation: () => ({ pathname: '/dashboard/org-1/documents' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@tale/ui/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));
// Peripheral surfaces with reads of their own.
vi.mock('./rag-status-badge', () => ({ RagStatusBadge: () => null }));
vi.mock('./documents-action-menu', () => ({
  DocumentsActionMenu: () => null,
}));
vi.mock('./document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));
vi.mock('./breadcrumb-navigation', () => ({
  BreadcrumbNavigation: () => null,
}));

const DOCUMENTS = /^GET \/api\/app\/documents\/paginated\?/;
const FOLDERS = /^GET \/api\/app\/folders\?parentId=&/;

const folder = (id: string, name: string) => ({
  id,
  organizationId: 'org-1',
  name,
  parentId: null,
  teamId: null,
  teamTags: [],
  projectId: null,
  createdBy: 'user-1',
  createdAt: 1789450000000,
});
const documentRow = (id: string, name: string) => ({
  id,
  name,
  fileId: `s3:org-1/${id}`,
  type: 'file',
  sourceProvider: 'upload',
  sourceMode: 'manual',
  uploadedAt: 1789450000000,
  teamId: null,
  teamIds: [],
  projectId: null,
  size: 1024,
  mimeType: 'application/pdf',
});
const FOLDER_ROWS = [folder('f-1', 'Contracts'), folder('f-2', 'Invoices')];
const DOCUMENT_ROWS = [
  documentRow('d-1', 'Contract terms.pdf'),
  documentRow('d-2', 'Invoice 2026.pdf'),
];
const documentsPage = (rows: readonly unknown[]) => () =>
  Response.json({ page: rows, isDone: true, continueCursor: '' });

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/documents');
  backend = syntheticBackend();
  backend.on(/^GET \/api\/app\/documents\/approx-count/, () =>
    Response.json({ count: 4 }),
  );
  backend.on(/^GET \/api\/app\/teams/, () => Response.json({ teams: [] }));
  backend.on(FOLDERS, () => Response.json({ folders: FOLDER_ROWS }));
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTable() {
  return render(
    <QueryClientProvider client={client}>
      <DocumentsTable organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string, ns = 'documents', values = {}) =>
  i18n.t(key, { ns, ...values });
const entity = () => ({
  entityOne: t('entityLabelOne'),
  entityOther: t('entityLabel'),
});
const footer = (key: string, count: number) =>
  t(`pagination.${key}`, 'common', { count, ...entity() });
const tryAgain = () => t('actions.tryAgain', 'common');
const region = () =>
  screen.getByRole('region', { name: t('documents', 'knowledge') });
const notice = () => screen.findByRole('alert', {}, { timeout: 5000 });

// These run the real retry policy several times over; they need more than
// the default five seconds on a loaded runner.
describe(
  'DocumentsTable when its documents read fails beside loaded folders',
  { timeout: 30_000 },
  () => {
    it('keeps the folders, names the missing documents with a retry, and never counts the folders as the whole library', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      renderTable();

      const alert = await notice();
      expect(alert).toHaveTextContent(t('loadFailed'));
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      expect(backend.count(DOCUMENTS)).toBe(4);
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      expect(screen.getByText('Invoices')).toBeInTheDocument();
      expect(
        screen.getByText(footer('showingLoadedFailed', 2)),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(footer('showingAll', 2)),
      ).not.toBeInTheDocument();
    });

    it('lists the folders with no failure when the documents answer empty', async () => {
      backend.on(DOCUMENTS, documentsPage([]));
      renderTable();

      expect(
        await screen.findByText(footer('showingAll', 2)),
      ).toBeInTheDocument();
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps the folders and the notice through a retry that fails, and lists everything once one works', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      const { user } = renderTable();
      const alert = await notice();
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      // From the keyboard: the retry moves focus onto the list first.
      retry.focus();
      await user.keyboard('{Enter}');
      expect(region()).toHaveFocus();
      // The folders stay while it runs — no skeleton stands in for them.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      await waitFor(() => expect(backend.count(DOCUMENTS)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('alert')).toBe(alert);
      expect(screen.getByText('Contracts')).toBeInTheDocument();
      expect(region()).toHaveFocus();

      backend.on(DOCUMENTS, documentsPage(DOCUMENT_ROWS));
      await user.click(retry);
      expect(await screen.findByText('Contract terms.pdf')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(footer('showingAll', 4))).toBeInTheDocument();
    });

    it('keeps the search and a rename draft through a background retry that fails and one that heals', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      const { user } = renderTable();
      await notice();

      await user.click(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      );
      await user.paste('Contr');
      expect(screen.queryByText('Invoices')).not.toBeInTheDocument();
      const contracts = screen.getByText('Contracts').closest('tr');
      if (contracts === null) throw new Error('no Contracts row');
      await user.click(
        within(contracts).getByRole('button', {
          name: t('actions.openMenu', 'common'),
        }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: t('actions.rename') }),
      );
      const name = await screen.findByLabelText(t('folder.folderName'));
      await user.clear(name);
      await user.type(name, 'Contracts 2027');

      // A refresh nobody asked for — the tab regaining focus — fails again.
      const before = backend.count(DOCUMENTS);
      void client.refetchQueries({ type: 'active' });
      await waitFor(() => expect(backend.count(DOCUMENTS)).toBe(before + 4));
      expect(screen.getByLabelText(t('folder.folderName'))).toHaveValue(
        'Contracts 2027',
      );
      // Behind the open dialog, so out of the accessibility tree for now.
      expect(
        screen.getByRole('textbox', {
          name: t('searchPlaceholder'),
          hidden: true,
        }),
      ).toHaveValue('Contr');

      // The next one heals the read: the draft is still there, and the
      // documents the search matches join the folder behind it.
      backend.on(DOCUMENTS, documentsPage(DOCUMENT_ROWS));
      void client.refetchQueries({ type: 'active' });
      await waitFor(() =>
        expect(screen.queryByText(t('loadFailed'))).not.toBeInTheDocument(),
      );
      expect(screen.getByText('Contract terms.pdf')).toBeInTheDocument();
      expect(screen.getByLabelText(t('folder.folderName'))).toHaveValue(
        'Contracts 2027',
      );
    });

    it('says a search that matches no folder searched only what loaded, and keeps the search box', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      const { user } = renderTable();
      await notice();

      await user.click(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      );
      await user.paste('zzz');
      expect(
        screen.getByText(t('search.noLoadedResults', 'common')),
      ).toBeInTheDocument();
      expect(
        screen.getByText(t('search.restNotSearched', 'common')),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('textbox', { name: t('searchPlaceholder') }),
      ).toHaveValue('zzz');
      expect(screen.getByRole('alert')).toHaveTextContent(t('loadFailed'));
    });

    // #3944 review: more folders than one page, and a search that matches
    // them all reset the window to one page — with nothing more to page in,
    // the rest of the loaded folders were out of reach, even after clearing.
    it('keeps every loaded folder reachable through a search above one page, and its clearing', async () => {
      const many = Array.from({ length: 35 }, (_, index) => {
        const n = String(index + 1).padStart(2, '0');
        return folder(`f-${n}`, `Contract ${n}`);
      });
      backend.on(FOLDERS, () => Response.json({ folders: many }));
      backend.on(DOCUMENTS, () => serviceUnavailable());
      const { user } = renderTable();
      await notice();
      const listed = () => screen.queryAllByText(/^Contract \d\d$/).length;
      expect(listed()).toBe(35);

      const box = screen.getByRole('textbox', { name: t('searchPlaceholder') });
      await user.click(box);
      await user.paste('Contract');
      expect(listed()).toBe(35);
      expect(
        screen.getByText(footer('showingLoadedFailed', 35)),
      ).toBeInTheDocument();

      await user.clear(box);
      expect(listed()).toBe(35);

      // A narrower search, then clearing it, reopens the whole level too.
      await user.paste('Contract 3');
      expect(listed()).toBe(6);
      await user.clear(box);
      expect(listed()).toBe(35);
      expect(
        screen.getByText(footer('showingLoadedFailed', 35)),
      ).toBeInTheDocument();
    });

    it('keeps a focused Try again through a background refresh that fails again, and hands focus to the list once it heals', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      renderTable();
      const alert = await notice();
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();

      const before = backend.count(DOCUMENTS);
      void client.refetchQueries({ type: 'active' });
      await waitFor(() => expect(backend.count(DOCUMENTS)).toBe(before + 4));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('alert')).toBe(alert);
      expect(retry).toHaveFocus();

      backend.on(DOCUMENTS, documentsPage(DOCUMENT_ROWS));
      void client.refetchQueries({ type: 'active' });
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(region()).toHaveFocus());
    });

    it('shows the table error state when the documents fail and there is nothing else to list', async () => {
      backend.on(FOLDERS, () => Response.json({ folders: [] }));
      backend.on(DOCUMENTS, () => serviceUnavailable());
      renderTable();

      expect(
        await screen.findByRole(
          'button',
          { name: t('errors.tryAgain', 'common') },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(t('emptyState.title'))).not.toBeInTheDocument();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the missing documents and the partial count in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(DOCUMENTS, () => serviceUnavailable());
        renderTable();

        const alert = await notice();
        expect(alert).toHaveTextContent(t('loadFailed'));
        expect(t('loadFailed')).not.toBe('loadFailed');
        expect(
          screen.getByText(footer('showingLoadedFailed', 2)),
        ).toBeInTheDocument();
      });
    });
  },
);

// At the hub's root the documents read lists only unfiled documents, so a
// library whose documents all sit in folders reaches them through the folder
// list alone. A folder list that never answered read as "No documents yet" —
// no failure named, no retry — while the approximate count said otherwise
// (#3880). The folder read runs for real here, with its retry policy.
describe(
  'DocumentsTable when its folder list fails at the hub root',
  { timeout: 30_000 },
  () => {
    beforeEach(() => {
      backend.on(/^GET \/api\/app\/documents\/approx-count/, () =>
        Response.json({ count: 1 }),
      );
    });

    const emptyTitle = () => screen.queryByText(t('emptyState.title'));

    it('names the folders that never answered with a retry, never an empty library', async () => {
      backend.on(DOCUMENTS, documentsPage([]));
      backend.on(FOLDERS, () => serviceUnavailable());
      renderTable();

      const alert = await notice();
      expect(alert).toHaveTextContent(t('foldersLoadFailed'));
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      expect(backend.count(FOLDERS)).toBe(4);
      expect(emptyTitle()).not.toBeInTheDocument();
    });

    it('keeps the empty state, with no notice, for a library that is empty', async () => {
      backend.on(DOCUMENTS, documentsPage([]));
      backend.on(FOLDERS, () => Response.json({ folders: [] }));
      renderTable();

      expect(
        await screen.findByText(t('emptyState.title')),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps the notice and a busy Try again through a retry, never the empty state, and lists the folders once one works', async () => {
      backend.on(DOCUMENTS, documentsPage([]));
      backend.on(FOLDERS, () => serviceUnavailable());
      const { user } = renderTable();
      const alert = await notice();
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      const documentReads = backend.count(DOCUMENTS);

      // The retry's first attempt is held in flight.
      let release: (reply: Response) => void = () => {};
      backend.on(
        FOLDERS,
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      );
      retry.focus();
      await user.keyboard('{Enter}');
      expect(region()).toHaveFocus();
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(backend.count(FOLDERS)).toBe(5);
      expect(screen.getByRole('alert')).toBe(alert);
      expect(emptyTitle()).not.toBeInTheDocument();

      // It fails too: the same notice stays, ready again.
      backend.on(FOLDERS, () => serviceUnavailable());
      release(serviceUnavailable());
      await waitFor(() => expect(backend.count(FOLDERS)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('alert')).toBe(alert);
      expect(emptyTitle()).not.toBeInTheDocument();
      expect(region()).toHaveFocus();

      backend.on(FOLDERS, () =>
        Response.json({ folders: [folder('f-1', 'Contracts')] }),
      );
      await user.click(retry);
      expect(await screen.findByText('Contracts')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(emptyTitle()).not.toBeInTheDocument();
      expect(screen.getByText(footer('showingAll', 1))).toBeInTheDocument();
      // Only the folders were read again; the documents had answered.
      expect(backend.count(DOCUMENTS)).toBe(documentReads);
    });

    it('keeps a focused Try again through a background refresh that fails again, and hands focus to the list once it heals', async () => {
      backend.on(DOCUMENTS, documentsPage([]));
      backend.on(FOLDERS, () => serviceUnavailable());
      renderTable();
      const alert = await notice();
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();

      const before = backend.count(FOLDERS);
      void client.refetchQueries({ type: 'active' });
      await waitFor(() => expect(backend.count(FOLDERS)).toBe(before + 4));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('alert')).toBe(alert);
      expect(retry).toHaveFocus();
      expect(emptyTitle()).not.toBeInTheDocument();

      backend.on(FOLDERS, () =>
        Response.json({ folders: [folder('f-1', 'Contracts')] }),
      );
      void client.refetchQueries({ type: 'active' });
      expect(await screen.findByText('Contracts')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(region()).toHaveFocus());
    });

    it('keeps the documents and names the missing folders, never counting the documents as all', async () => {
      backend.on(DOCUMENTS, documentsPage(DOCUMENT_ROWS));
      backend.on(FOLDERS, () => serviceUnavailable());
      renderTable();

      const alert = await notice();
      expect(alert).toHaveTextContent(t('foldersLoadFailed'));
      expect(screen.getByText('Contract terms.pdf')).toBeInTheDocument();
      expect(
        screen.getByText(footer('showingLoadedFailed', 2)),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(footer('showingAll', 2)),
      ).not.toBeInTheDocument();
    });

    it('shows the table error state when both reads fail, and its Try again reads the folders again too', async () => {
      backend.on(DOCUMENTS, () => serviceUnavailable());
      backend.on(FOLDERS, () => serviceUnavailable());
      const { user } = renderTable();

      const retry = await screen.findByRole(
        'button',
        { name: t('errors.tryAgain', 'common') },
        { timeout: 5000 },
      );
      await waitFor(() => expect(backend.count(FOLDERS)).toBe(4));
      expect(
        screen.queryByText(t('foldersLoadFailed')),
      ).not.toBeInTheDocument();
      expect(emptyTitle()).not.toBeInTheDocument();

      backend.on(DOCUMENTS, documentsPage([]));
      backend.on(FOLDERS, () =>
        Response.json({ folders: [folder('f-1', 'Contracts')] }),
      );
      await user.click(retry);
      expect(await screen.findByText('Contracts')).toBeInTheDocument();
      expect(backend.count(FOLDERS)).toBe(5);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the folders that never answered in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(DOCUMENTS, documentsPage([]));
        backend.on(FOLDERS, () => serviceUnavailable());
        renderTable();

        const alert = await notice();
        expect(alert).toHaveTextContent(t('foldersLoadFailed'));
        expect(t('foldersLoadFailed')).not.toBe('foldersLoadFailed');
        if (locale !== 'en') {
          expect(t('foldersLoadFailed')).not.toBe(
            i18n.t('foldersLoadFailed', { ns: 'documents', lng: 'en' }),
          );
        }
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        expect(emptyTitle()).not.toBeInTheDocument();
      });
    });
  },
);
