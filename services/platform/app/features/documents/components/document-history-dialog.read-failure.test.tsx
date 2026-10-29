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

import { DocumentHistoryDialog } from './document-history-dialog';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4577: a version history that failed to load said only that, with no way
// to load it again short of closing the dialog. The versions read runs for
// real here (hook, adapter row, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport.

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});
vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const VERSIONS = /^GET \/api\/app\/documents\/versions\/doc-1\?orgId=org-1$/;

/** The door's answer for `doc-1`: the current file, then the one it replaced. */
const HISTORY = {
  versions: {
    documentId: 'doc-1',
    title: 'contract.docx',
    versions: [
      {
        storageId: 'blob-2',
        createdAt: Date.UTC(2026, 8, 2),
        isCurrent: true,
        fileName: 'contract.docx',
      },
      {
        storageId: 'blob-1',
        createdAt: Date.UTC(2026, 8, 1),
        isCurrent: false,
        fileName: 'contract.docx',
      },
    ],
  },
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderDialog() {
  return render(
    <QueryClientProvider client={client}>
      <DocumentHistoryDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        documentId="doc-1"
      />
    </QueryClientProvider>,
  );
}

const documents = (key: string) => i18n.t(key, { ns: 'documents' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const dialog = () => screen.getByRole('dialog');
// Where focus lands when the notice that held it goes: the versions section.
const versions = () =>
  screen.getByRole('group', { name: documents('history.versionsLabel') });

describe(
  'DocumentHistoryDialog when the version history read fails',
  { timeout: 30_000 },
  () => {
    it('lists the versions of the file', async () => {
      backend.on(VERSIONS, () => Response.json(HISTORY));
      renderDialog();

      expect(await within(dialog()).findAllByRole('option')).toHaveLength(2);
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says so when the history cannot load, and recovers on Try again', async () => {
      backend.on(VERSIONS, () => serviceUnavailable());
      const { user } = renderDialog();

      const alert = await within(dialog()).findByRole('alert');
      expect(alert).toHaveTextContent(documents('history.loadFailed'));
      expect(backend.count(VERSIONS)).toBe(4);
      // Unavailable is neither a file without versions nor a read still
      // loading, and the dialog says it without a toast.
      expect(
        within(dialog()).queryByText(documents('history.empty')),
      ).not.toBeInTheDocument();
      expect(within(dialog()).queryByRole('status')).not.toBeInTheDocument();
      expect(toast).not.toHaveBeenCalled();

      backend.on(VERSIONS, () => Response.json(HISTORY));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      expect(await within(dialog()).findAllByRole('option')).toHaveLength(2);
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
      // Try again kept focus inside the dialog, on the versions it restored.
      expect(versions()).toHaveFocus();
    });

    it('keeps Try again focusable and inert while the retry runs', async () => {
      backend.on(VERSIONS, () => serviceUnavailable());
      const { user } = renderDialog();
      const alert = await within(dialog()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        VERSIONS,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(retry);
      await waitFor(() => expect(backend.count(VERSIONS)).toBe(5));
      // The notice stays up, busy, while the read runs again; focus waits on
      // the versions it will restore.
      expect(retry).toHaveAttribute('aria-busy', 'true');
      expect(within(dialog()).getByRole('alert')).toBe(alert);
      expect(
        within(dialog()).queryByText(documents('history.loading')),
      ).not.toBeInTheDocument();
      expect(versions()).toHaveFocus();

      // A second press while it runs starts no second read.
      await user.click(retry);
      expect(retry).toHaveFocus();
      expect(backend.count(VERSIONS)).toBe(5);

      answer(Response.json(HISTORY));
      expect(await within(dialog()).findAllByRole('option')).toHaveLength(2);
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
      await waitFor(() => expect(versions()).toHaveFocus());
    });

    it('says the history is loading while the first read is in flight', async () => {
      backend.on(VERSIONS, () => new Promise<Response>(() => {}));
      renderDialog();

      expect(within(dialog()).getByRole('status')).toHaveTextContent(
        documents('history.loading'),
      );
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps loaded versions through a failed refresh, with a retry', async () => {
      backend.on(VERSIONS, () => Response.json(HISTORY));
      const { user } = renderDialog();
      await within(dialog()).findAllByRole('option');

      backend.on(VERSIONS, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await within(dialog()).findByRole('alert');
      expect(alert).toHaveTextContent(documents('history.refreshFailed'));
      expect(within(dialog()).getAllByRole('option')).toHaveLength(2);

      backend.on(VERSIONS, () => Response.json(HISTORY));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(within(dialog()).getAllByRole('option')).toHaveLength(2);
    });

    it('says a file the history no longer reaches has no stored versions', async () => {
      // A deleted or archived file, or one out of reach: the read worked.
      backend.on(VERSIONS, () => Response.json({ versions: null }));
      renderDialog();

      expect(
        await within(dialog()).findByText(documents('history.empty')),
      ).toBeInTheDocument();
      expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps a focused Try again focused when a background refresh fails again', async () => {
      backend.on(VERSIONS, () => serviceUnavailable());
      renderDialog();
      const alert = await within(dialog()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      const firstMessage = within(alert).getByText(
        documents('history.loadFailed'),
      );
      retry.focus();

      void client.invalidateQueries();
      await waitFor(() => expect(backend.count(VERSIONS)).toBe(8));
      await waitFor(() =>
        expect(
          within(dialog()).getByText(documents('history.loadFailed')),
        ).not.toBe(firstMessage),
      );

      expect(within(dialog()).getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
    });

    it('moves the focus to the versions when a background refresh heals them behind a focused Try again', async () => {
      backend.on(VERSIONS, () => serviceUnavailable());
      renderDialog();
      const alert = await within(dialog()).findByRole('alert');
      within(alert).getByRole('button', { name: tryAgain() }).focus();

      backend.on(VERSIONS, () => Response.json(HISTORY));
      void client.invalidateQueries();
      await within(dialog()).findAllByRole('option');
      await waitFor(() => expect(versions()).toHaveFocus());
    });

    it('leaves the focus where the reader moved it during the refresh', async () => {
      backend.on(VERSIONS, () => serviceUnavailable());
      renderDialog();
      const alert = await within(dialog()).findByRole('alert');
      within(alert).getByRole('button', { name: tryAgain() }).focus();
      const close = screen.getByRole('button', {
        name: i18n.t('aria.close', { ns: 'common' }),
      });
      close.focus();

      backend.on(VERSIONS, () => Response.json(HISTORY));
      void client.invalidateQueries();
      await within(dialog()).findAllByRole('option');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(close).toHaveFocus();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed history and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(VERSIONS, () => serviceUnavailable());
        renderDialog();

        const alert = await within(dialog()).findByRole('alert');
        expect(alert).toHaveTextContent(documents('history.loadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        // Each locale carries both notices itself, not by falling back.
        for (const key of ['history.loadFailed', 'history.refreshFailed']) {
          expect(i18n.getResource(locale, 'documents', key)).toEqual(
            expect.any(String),
          );
        }
      });
    });
  },
);
