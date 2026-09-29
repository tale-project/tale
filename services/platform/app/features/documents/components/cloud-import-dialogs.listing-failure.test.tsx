import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
import type { ActionName } from '@/app/lib/backend/contract';
import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { GoogleDriveImportDialog } from './google-drive-import-dialog';
import { OneDriveImportDialog } from './onedrive-import-dialog';

// A picker's listing runs its write as a query that retries it twice. Each
// attempt used to raise the write's own toast, and a `success: false` answer
// raised none at all. The listings run for real here — the queries, their
// retries, `useBackendAction`, the adapter row — and the real toast renders,
// so the test counts every toast a failed listing raises.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], isLoading: false }),
}));
// A connected account; every listing is the real query.
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useCloudImportAuthorizationStatus: () => ({
    data: { status: 'active' },
    isLoading: false,
    error: null,
  }),
}));

const documents = (key: string) => i18n.t(key, { ns: 'documents' });

/** The provider's own answer to a refused listing: English, and its body. */
const RAW_ANSWER = 'OneDrive API error: 403 {"error":{"code":"accessDenied"}}';

/** Every call of a listing answers `answer`. */
function listingAnswers(name: ActionName, answer: () => Promise<unknown>) {
  return vi.spyOn(WRITE_ADAPTERS[name], 'run').mockImplementation(answer);
}

function renderDialog(
  Dialog: typeof OneDriveImportDialog | typeof GoogleDriveImportDialog,
  onRequireConnect = vi.fn(),
) {
  // Retries without their backoff: the count is what the test pins.
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Dialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        onRequireConnect={onRequireConnect}
      />
      <Toaster />
    </QueryClientProvider>,
  );
}

function shownToasts() {
  return vi.mocked(toast).mock.calls.map(([shown]) => ({
    title: shown.title,
    description: shown.description,
    variant: shown.variant,
  }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
});

const DIALOGS = [
  {
    provider: 'Microsoft 365',
    Dialog: OneDriveImportDialog,
    listing: 'onedrive/actions:listFiles',
    title: 'onedrive.loadFailed',
  },
  {
    provider: 'Google Drive',
    Dialog: GoogleDriveImportDialog,
    listing: 'google_drive/actions:listFiles',
    title: 'googledrive.loadFailed',
  },
] as const;

describe.each(DIALOGS)(
  'the $provider picker when its listing fails',
  ({ Dialog, listing, title }) => {
    it('says so once, after the retries, with the localized title alone', async () => {
      const run = listingAnswers(listing, async () => ({
        success: false,
        error: RAW_ANSWER,
      }));
      renderDialog(Dialog);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(run).toHaveBeenCalledTimes(3);
      expect(shownToasts()).toEqual([
        {
          title: documents(title),
          description: undefined,
          variant: 'destructive',
        },
      ]);
      expect(JSON.stringify(shownToasts())).not.toContain('API error');
    });

    it("says so once with a refusal's own words", async () => {
      const run = listingAnswers(listing, () =>
        Promise.reject(
          new AppError({
            code: 'CLOUD_PROVIDER_UNAVAILABLE',
            message: 'The provider did not answer in time.',
          }),
        ),
      );
      renderDialog(Dialog);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(run).toHaveBeenCalledTimes(3);
      expect(shownToasts()).toEqual([
        {
          title: documents(title),
          description: 'The provider did not answer in time.',
          variant: 'destructive',
        },
      ]);
    });

    it('hands a lapsed grant to the connect dialog, with no toast', async () => {
      listingAnswers(listing, async () => ({
        success: false,
        error: 'Cloud import is not authorized',
      }));
      const onRequireConnect = vi.fn();
      renderDialog(Dialog, onRequireConnect);

      await waitFor(() => expect(onRequireConnect).toHaveBeenCalled());
      expect(toast).not.toHaveBeenCalled();
    });
  },
);

// A grant that lapses while a person browses SharePoint first shows on the
// drives listing: it used to be neither toasted nor handed off.
it('hands a lapsed grant on the SharePoint drives listing to the connect dialog', async () => {
  listingAnswers('onedrive/actions:listFiles', async () => ({
    success: true,
    items: [],
  }));
  listingAnswers('onedrive/actions:listSharePointSites', async () => ({
    success: true,
    sites: [
      {
        id: 'site-1',
        name: 'team',
        displayName: 'Team site',
        webUrl: 'https://contoso.sharepoint.com/sites/team',
      },
    ],
  }));
  listingAnswers('onedrive/actions:listSharePointDrives', async () => ({
    success: false,
    error: 'OneDrive is not authorized',
  }));
  const onRequireConnect = vi.fn();
  const { user } = renderDialog(OneDriveImportDialog, onRequireConnect);

  await user.click(
    screen.getByRole('tab', {
      name: documents('microsoft365.sharePointSites'),
    }),
  );
  await user.click(await screen.findByText('Team site'));

  await waitFor(() => expect(onRequireConnect).toHaveBeenCalled());
  expect(toast).not.toHaveBeenCalled();
});
