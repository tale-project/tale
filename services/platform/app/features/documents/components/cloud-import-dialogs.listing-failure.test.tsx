import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UserEvent } from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { type WriteAdapter, WRITE_ADAPTERS } from '@/app/lib/backend/adapters';
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

const documents = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'documents', ...options });
const common = (key: string) => i18n.t(key, { ns: 'common' });

/** The provider's own answer to a refused listing: English, and its body. */
const RAW_ANSWER = 'OneDrive API error: 403 {"error":{"code":"accessDenied"}}';

/** A refusal the door answered, with words of its own. */
const REFUSAL = 'The provider did not answer in time.';
const refused = () =>
  Promise.reject(
    new AppError({ code: 'CLOUD_PROVIDER_UNAVAILABLE', message: REFUSAL }),
  );

/** A grant that lapsed: the listing's answer the dialogs hand off on. */
const LAPSED_GRANT = {
  success: false,
  error: 'Cloud import is not authorized',
};

/** A lapsed grant as the Microsoft doors word it (`resolveGraphTokenForUser`),
 * for every SharePoint listing. */
const MICROSOFT_LAPSED_GRANT = {
  success: false,
  error:
    'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.',
};

const SITE = {
  id: 'site-1',
  name: 'team',
  displayName: 'Team site',
  webUrl: 'https://contoso.sharepoint.com/sites/team',
};
const DRIVE = {
  id: 'drive-1',
  name: 'Team library',
  driveType: 'documentLibrary',
};
/** The folder a person selects to import: the walk lists it again. */
const FOLDER = { id: 'folder-1', name: 'Meetings', size: 0, isFolder: true };

type Answer = (args: Record<string, unknown>) => Promise<unknown>;

/** The folder's own answer when the import walks it, the top level's else. */
const walkAnswers =
  (top: () => Promise<unknown>, walked: () => Promise<unknown>): Answer =>
  (args) =>
    args.folderId === FOLDER.id ? walked() : top();

/**
 * Every listing answers as a connected account's would — a top level that
 * holds {@link FOLDER}, one site, one library — except those `answers`
 * names. Returns each listing's spy.
 */
function listingsAnswer(answers: Partial<Record<ActionName, Answer>> = {}) {
  const connected: Partial<Record<ActionName, Answer>> = {
    'onedrive/actions:listFiles': async () => ({
      success: true,
      items: [FOLDER],
    }),
    'google_drive/actions:listFiles': async () => ({
      success: true,
      items: [FOLDER],
    }),
    'onedrive/actions:listSharePointSites': async () => ({
      success: true,
      sites: [SITE],
    }),
    'onedrive/actions:listSharePointDrives': async () => ({
      success: true,
      drives: [DRIVE],
    }),
    'onedrive/actions:listSharePointFiles': async () => ({
      success: true,
      items: [FOLDER],
    }),
  };
  const runs = new Map<string, MockInstance<WriteAdapter['run']>>();
  for (const [name, answer] of Object.entries({ ...connected, ...answers })) {
    if (answer === undefined) continue;
    runs.set(
      name,
      vi.spyOn(WRITE_ADAPTERS[name], 'run').mockImplementation(answer),
    );
  }
  return runs;
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

/** Open the SharePoint tab and walk down to `depth`'s listing. */
async function browseSharePoint(
  user: UserEvent,
  depth: 'sites' | 'drives' | 'files',
) {
  await user.click(
    screen.getByRole('tab', {
      name: documents('microsoft365.sharePointSites'),
    }),
  );
  if (depth === 'sites') return;
  await user.click(await screen.findByText(SITE.displayName));
  if (depth === 'drives') return;
  await user.click(await screen.findByText(DRIVE.name));
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
      const runs = listingsAnswer({
        [listing]: async () => ({ success: false, error: RAW_ANSWER }),
      });
      renderDialog(Dialog);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(runs.get(listing)).toHaveBeenCalledTimes(3);
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
      const runs = listingsAnswer({ [listing]: refused });
      renderDialog(Dialog);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(runs.get(listing)).toHaveBeenCalledTimes(3);
      expect(shownToasts()).toEqual([
        {
          title: documents(title),
          description: REFUSAL,
          variant: 'destructive',
        },
      ]);
    });

    it('hands a lapsed grant to the connect dialog, with no toast', async () => {
      listingsAnswer({ [listing]: async () => LAPSED_GRANT });
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
  listingsAnswer({
    'onedrive/actions:listSharePointDrives': async () => MICROSOFT_LAPSED_GRANT,
  });
  const onRequireConnect = vi.fn();
  const { user } = renderDialog(OneDriveImportDialog, onRequireConnect);

  await browseSharePoint(user, 'drives');

  await waitFor(() => expect(onRequireConnect).toHaveBeenCalled());
  expect(toast).not.toHaveBeenCalled();
});

// Importing a selected folder lists it again, and a folder that cannot be
// listed whole stops the import. A `success: false` answer to that walk put
// the provider's own answer — English, often its raw body — under the
// localized **Import failed**. It goes to the log now; a refusal keeps its
// words, and so does a folder too large to import whole.
describe.each([
  {
    source: 'OneDrive',
    Dialog: OneDriveImportDialog,
    ns: 'onedrive',
    walk: 'onedrive/actions:listFiles',
    importer: 'onedrive/actions:importFiles',
    rawAnswer: RAW_ANSWER,
    open: async (_user: UserEvent) => {},
  },
  {
    source: 'SharePoint',
    Dialog: OneDriveImportDialog,
    ns: 'onedrive',
    walk: 'onedrive/actions:listSharePointFiles',
    importer: 'onedrive/actions:importFiles',
    rawAnswer:
      'Access denied. You may not have permission to access this location.',
    open: (user: UserEvent) => browseSharePoint(user, 'files'),
  },
  {
    source: 'Google Drive',
    Dialog: GoogleDriveImportDialog,
    ns: 'googledrive',
    walk: 'google_drive/actions:listFiles',
    importer: 'google_drive/actions:importFiles',
    rawAnswer: 'Google Drive API error: 403 {"error":{"code":403}}',
    open: async (_user: UserEvent) => {},
  },
] as const)(
  'the $source import when its folder walk fails',
  ({ Dialog, ns, walk, importer, rawAnswer, open }) => {
    const top = async () => ({ success: true, items: [FOLDER] });

    /** Select {@link FOLDER}, go to the import settings and import it. */
    async function importFolder(user: UserEvent) {
      await open(user);
      await user.click(
        await screen.findByRole('checkbox', {
          name: documents('aria.selectFolder', { name: FOLDER.name }),
        }),
      );
      await user.click(
        screen.getByRole('button', {
          name: documents(`${ns}.importCount`, { count: 1 }),
        }),
      );
      await user.click(
        screen.getByRole('button', {
          name: documents(`${ns}.importItems`, { count: 1 }),
        }),
      );
    }

    it("keeps the provider's answer out of the toast", async () => {
      const runs = listingsAnswer({
        [walk]: walkAnswers(top, async () => ({
          success: false,
          error: rawAnswer,
        })),
      });
      const imported = vi.spyOn(WRITE_ADAPTERS[importer], 'run');
      const { user } = renderDialog(Dialog);

      await importFolder(user);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(runs.get(walk)).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: FOLDER.id }),
        expect.anything(),
      );
      expect(imported).not.toHaveBeenCalled();
      expect(shownToasts()).toEqual([
        {
          title: documents(`${ns}.importFailed`),
          description: common('errors.generic'),
          variant: 'destructive',
        },
      ]);
      expect(JSON.stringify(shownToasts())).not.toContain('API error');
      expect(JSON.stringify(shownToasts())).not.toContain('Access denied');
      // The answer is kept for whoever reads the log.
      expect(vi.mocked(console.warn).mock.calls.flat()).toContain(rawAnswer);
    });

    it("keeps a refusal's own words", async () => {
      listingsAnswer({ [walk]: walkAnswers(top, refused) });
      const { user } = renderDialog(Dialog);

      await importFolder(user);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(shownToasts()).toEqual([
        {
          title: documents(`${ns}.importFailed`),
          description: REFUSAL,
          variant: 'destructive',
        },
      ]);
    });

    it('still says which folder is too large to import whole', async () => {
      listingsAnswer({
        [walk]: walkAnswers(top, async () => ({
          success: true,
          items: [
            { id: 'file-1', name: 'notes.docx', size: 10, isFolder: false },
          ],
          truncated: true,
        })),
      });
      const { user } = renderDialog(Dialog);

      await importFolder(user);

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(shownToasts()).toEqual([
        {
          title: documents(`${ns}.importFailed`),
          description: documents('onedrive.folderTooLargeToImport', {
            name: FOLDER.name,
          }),
          variant: 'destructive',
        },
      ]);
    });
  },
);
