import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import {
  BackendApiError,
  backendApiErrorFromBody,
} from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { DocumentHistoryDialog } from './document-history-dialog';

// The comparison runs for real — the hook, `useBackendAction`, the adapter
// row — and the real toast renders, so the test sees every place a failed
// comparison is reported.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});
vi.mock('../hooks/queries', () => ({
  useDocumentVersions: () => ({
    data: {
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
    isLoading: false,
    isError: false,
  }),
}));

const COMPARE = 'documents/compare_documents:compareDocuments';

/** A string as the dialog shows it in the current language. */
const documents = (key: string) => i18n.t(key, { ns: 'documents' });

/** Open the history, pick both versions and compare them. */
async function compareBothVersions() {
  const { user } = render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentHistoryDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        documentId="doc-1"
      />
      <Toaster />
    </QueryClientProvider>,
  );
  const [current, earlier] = screen.getAllByRole('option');
  await user.click(within(current).getByRole('button'));
  await user.click(within(earlier).getByRole('button'));
  await user.click(
    screen.getByRole('button', { name: documents('history.compareSelected') }),
  );
  return screen.getByRole('dialog');
}

/** The comparison answers `failure` instead of the offline refusal. */
function comparisonFails(failure: () => unknown) {
  vi.spyOn(WRITE_ADAPTERS[COMPARE], 'run').mockImplementation(() =>
    Promise.reject(failure()),
  );
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
});

afterEach(async () => {
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  // Unmount first: the app shell still applying the saved language would
  // otherwise switch it back after the reset.
  cleanup();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

describe('DocumentHistoryDialog when a comparison fails', () => {
  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    beforeEach(async () => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
    });

    // The refusal's own `message` is its serialized payload
    // (`{"code":"UNAUTHORIZED",…}`), which the toast and the picker used to
    // show.
    it('says the session ended after a lapse', async () => {
      comparisonFails(() =>
        backendApiErrorFromBody(
          LAPSED_SESSION_ANSWER.status,
          LAPSED_SESSION_ANSWER.body,
        ),
      );

      const dialog = await compareBothVersions();

      expect(
        await within(dialog).findByText(SESSION_ENDED[locale]),
      ).toBeVisible();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({
        title: documents('history.compareFailed'),
        description: SESSION_ENDED[locale],
        variant: 'destructive',
      });
      expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
    });

    // The lane answers every comparison with this refusal; its words were
    // English in every language.
    it('says comparing is unavailable while the lane is offline', async () => {
      const dialog = await compareBothVersions();

      const offline = documents('history.compareOffline');
      expect(await within(dialog).findByText(offline)).toBeVisible();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({
        title: documents('history.compareFailed'),
        description: offline,
        variant: 'destructive',
      });
    });

    it('says only that it failed for a fault', async () => {
      comparisonFails(() => new BackendApiError(503, 'Service Unavailable'));

      const dialog = await compareBothVersions();

      expect(
        await within(dialog).findByText(documents('history.compareFailed')),
      ).toBeVisible();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith({
        title: documents('history.compareFailed'),
        description: undefined,
        variant: 'destructive',
      });
    });
  });
});
