import { toast } from '@tale/ui/use-toast';
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

// #4577: the History deep link (`?historyExternalItemId=`) told the person
// their file had no version history when the lookup had only failed, and
// stripped the link, so a reload could not try it again. The lookup runs for
// real here (hook, adapter row, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport, beside the tab's own reads;
// the version history dialog is stubbed to the document it was asked to open.

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useProject: () => ({ project: { canEdit: false }, isLoading: false }),
}));
vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/features/documents/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/documents/hooks/queries')
  >()),
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
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/app/features/documents/components/document-preview-dialog', () => ({
  DocumentPreviewDialog: () => null,
}));
vi.mock('@/app/features/documents/components/document-history-dialog', () => ({
  DocumentHistoryDialog: ({
    open,
    documentId,
    title,
  }: {
    open: boolean;
    documentId: string | null;
    title?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {documentId}
      </div>
    ) : null,
}));

const LOOKUP =
  /^GET \/api\/app\/documents\/by-external-item-id\?externalItemId=case-1&projectId=proj-a&orgId=org-1$/;
const DOCS = /^GET \/api\/app\/documents\/by-project\/proj-a\?orgId=org-1$/;
const FOLDERS = /^GET \/api\/app\/folders\?projectId=proj-a&orgId=org-1$/;

/** The lookup's answer for `case-1`: a file inside the Contracts folder. */
const FOUND = {
  document: {
    documentId: 'd-contract',
    title: 'contract-a.txt',
    folderId: 'f-contracts',
    hasHistory: true,
  },
};

/** The link, used up: the tab's address without it. */
const LINK_USED_UP = {
  to: '/dashboard/$id/projects/$projectId/files',
  params: { id: 'org-1', projectId: 'proj-a' },
  search: { folderId: 'f-contracts' },
  replace: true,
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(DOCS, () =>
    Response.json({
      documents: [
        {
          id: 'd-contract',
          name: 'contract-a.txt',
          type: 'file',
          fileId: 'blob-d-contract',
          mimeType: 'text/plain',
          extension: 'txt',
          ragStatus: 'completed',
          uploadedAt: 1789450000000,
          folderId: 'f-contracts',
        },
      ],
    }),
  );
  backend.on(FOLDERS, () =>
    Response.json({
      folders: [
        {
          id: 'f-contracts',
          organizationId: 'org-1',
          name: 'Contracts',
          parentId: null,
          teamId: null,
          teamTags: [],
          projectId: 'proj-a',
          createdBy: 'user-1',
          createdAt: 1789450000000,
        },
      ],
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  mockNavigate.mockClear();
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderTab() {
  return render(
    <QueryClientProvider client={client}>
      <ProjectFilesTab
        organizationId="org-1"
        projectId="proj-a"
        historyExternalItemId="case-1"
      />
    </QueryClientProvider>,
  );
}

const documents = (key: string) => i18n.t(key, { ns: 'documents' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const filesArea = () =>
  screen.getByRole('group', {
    name: i18n.t('files.title', { ns: 'projects' }),
  });

describe(
  'ProjectFilesTab History deep link when its lookup fails',
  { timeout: 30_000 },
  () => {
    it('opens the version history of the file the link names, and uses the link up', async () => {
      backend.on(LOOKUP, () => Response.json(FOUND));
      renderTab();

      expect(
        await screen.findByRole('dialog', { name: 'contract-a.txt' }),
      ).toHaveTextContent('d-contract');
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(LINK_USED_UP),
      );
      expect(
        await within(filesArea()).findByRole('button', { name: 'Contracts' }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(toast).not.toHaveBeenCalled();
    });

    it('says a file the link finds nothing for has no version history, and uses the link up', async () => {
      // The lookup worked and answered no file.
      backend.on(LOOKUP, () => Response.json({ document: null }));
      renderTab();

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: documents('history.notFound'),
          variant: 'destructive',
        }),
      );
      expect(mockNavigate).toHaveBeenCalledWith({
        ...LINK_USED_UP,
        search: {},
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(within(filesArea()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps the link and offers Try again when the lookup fails, then opens the history', async () => {
      backend.on(LOOKUP, () => serviceUnavailable());
      const { user } = renderTab();

      const alert = await within(filesArea()).findByRole('alert');
      expect(alert).toHaveTextContent(documents('history.linkLoadFailed'));
      expect(backend.count(LOOKUP)).toBe(4);
      // A failed lookup is not a file without history, and it does not use
      // the link up.
      expect(toast).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      let answer: (response: Response) => void = () => {};
      backend.on(
        LOOKUP,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      await user.click(retry);
      await waitFor(() => expect(backend.count(LOOKUP)).toBe(5));
      // The notice stays up, busy, while the lookup runs again; focus waits
      // on the files, where the notice was.
      expect(retry).toHaveAttribute('aria-busy', 'true');
      expect(filesArea()).toHaveFocus();
      expect(mockNavigate).not.toHaveBeenCalled();

      answer(Response.json(FOUND));
      expect(
        await screen.findByRole('dialog', { name: 'contract-a.txt' }),
      ).toHaveTextContent('d-contract');
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(LINK_USED_UP),
      );
      expect(within(filesArea()).queryByRole('alert')).not.toBeInTheDocument();
      expect(toast).not.toHaveBeenCalled();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed link and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(LOOKUP, () => serviceUnavailable());
        renderTab();

        const alert = await within(filesArea()).findByRole('alert');
        expect(alert).toHaveTextContent(documents('history.linkLoadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        // The locale carries the notice itself, not by falling back.
        expect(
          i18n.getResource(locale, 'documents', 'history.linkLoadFailed'),
        ).toEqual(expect.any(String));
      });
    });
  },
);
