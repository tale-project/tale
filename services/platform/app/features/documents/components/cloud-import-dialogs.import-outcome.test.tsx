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
import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { DocumentsActionMenu } from './documents-action-menu';

// How an import that did not finish reads, from the Documents menu to the
// last word on screen: the menu, the picker, the folder walk, the import
// through `useBackendAction` and its adapter row, the connect dialog and the
// real toast. The import's answer is the one the doors send
// (`backend/core/*/import_files.ts`): a grant that ended part-way answers
// the grant check's sentence beside the files it did import.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
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
// The connect dialog asks whether an OAuth app is set up: one is.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: { configured: true, source: 'env' },
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const documents = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'documents', ...options });

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
/** The folder a person selects to import. */
const FOLDER = { id: 'folder-1', name: 'Meetings', size: 0, isFolder: true };
/** What the import walk finds in it. */
const FILES = ['agenda.docx', 'minutes.docx', 'notes.docx', 'report.mov'].map(
  (name, index) => ({
    id: `file-${index + 1}`,
    name,
    size: 10,
    isFolder: false,
  }),
);

/** The size cap's refusal: a reason a person can read, in the door's words. */
const CAP = 'The file exceeds the 512 MiB limit';

type Answer = (args: Record<string, unknown>) => Promise<unknown>;

const SOURCES = [
  {
    source: 'OneDrive',
    menuItem: 'upload.fromMicrosoft365',
    ns: 'onedrive',
    provider: 'Microsoft 365',
    walk: 'onedrive/actions:listFiles',
    importer: 'onedrive/actions:importFiles',
    lapse:
      'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.',
    browse: async (_user: UserEvent) => {},
  },
  {
    source: 'SharePoint',
    menuItem: 'upload.fromMicrosoft365',
    ns: 'onedrive',
    provider: 'Microsoft 365',
    walk: 'onedrive/actions:listSharePointFiles',
    importer: 'onedrive/actions:importFiles',
    lapse:
      'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.',
    browse: async (user: UserEvent) => {
      await user.click(
        await screen.findByRole('tab', {
          name: documents('microsoft365.sharePointSites'),
        }),
      );
      await user.click(await screen.findByText(SITE.displayName));
      await user.click(await screen.findByText(DRIVE.name));
    },
  },
  {
    source: 'Google Drive',
    menuItem: 'upload.fromGoogleDrive',
    ns: 'googledrive',
    provider: 'Google Drive',
    walk: 'google_drive/actions:listFiles',
    importer: 'google_drive/actions:importFiles',
    lapse:
      'Google Drive is not authorized for importing. Connect Google Drive from Documents.',
    browse: async (_user: UserEvent) => {},
  },
] as const;

type Source = (typeof SOURCES)[number];

/** Every listing answers as a connected account's would: a top level that
 *  holds {@link FOLDER}, whose walk finds {@link FILES}; one site and one
 *  library. `walked` answers the walk instead. Returns each action's spy. */
function listingsAnswer(walked?: Answer) {
  const folderOrFiles: Answer = async (args) =>
    args.folderId === FOLDER.id
      ? (walked?.(args) ?? { success: true, items: FILES })
      : { success: true, items: [FOLDER] };
  const answers: Partial<Record<ActionName, Answer>> = {
    'onedrive/actions:listFiles': folderOrFiles,
    'google_drive/actions:listFiles': folderOrFiles,
    'onedrive/actions:listSharePointSites': async () => ({
      success: true,
      sites: [SITE],
    }),
    'onedrive/actions:listSharePointDrives': async () => ({
      success: true,
      drives: [DRIVE],
    }),
    'onedrive/actions:listSharePointFiles': folderOrFiles,
  };
  const runs = new Map<string, MockInstance<WriteAdapter['run']>>();
  for (const [name, answer] of Object.entries(answers)) {
    runs.set(
      name,
      vi.spyOn(WRITE_ADAPTERS[name], 'run').mockImplementation(answer),
    );
  }
  return runs;
}

/** The import's answer, the doors' own shape. */
function importAnswers(importer: Source['importer'], answer: unknown) {
  return vi
    .spyOn(WRITE_ADAPTERS[importer], 'run')
    .mockImplementation(async () => answer);
}

const imported = (fileName: string, index: number) => ({
  fileId: `file-${index + 1}`,
  fileName,
  status: 'success' as const,
  documentId: `doc-${index + 1}`,
});

async function renderMenu(locale: ShippedLocale = 'en') {
  saveLocale(locale);
  await i18n.changeLanguage(locale);
  // Listing retries without their backoff.
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsActionMenu organizationId="org-1" />
      <Toaster />
    </QueryClientProvider>,
  );
}

/** Open the source's picker from the menu, select {@link FOLDER} and import
 *  it once. */
async function importFolder(
  user: UserEvent,
  { menuItem, ns, browse }: Source,
  mode: 'one-time' | 'sync' = 'one-time',
) {
  await user.click(
    screen.getByRole('button', { name: documents('upload.importDocuments') }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: documents(menuItem) }),
  );
  // Wait for the real lazy picker module before timing its semantic content.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await browse(user);
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
  if (mode === 'sync') {
    await user.click(
      screen.getByRole('radio', { name: documents(`${ns}.syncImport`) }),
    );
  }
  await user.click(
    screen.getByRole('button', {
      name: documents(
        mode === 'sync' ? `${ns}.syncItems` : `${ns}.importItems`,
        {
          count: 1,
        },
      ),
    }),
  );
}

/** Dismissing a pending picker leaves the request running in the background. */
async function dismissImport(user: UserEvent, source: Source) {
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(
      screen.queryByText(documents(`${source.ns}.importStarted`)),
    ).toBeNull(),
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

async function openSelectedPicker(user: UserEvent, source: Source) {
  await user.click(
    screen.getByRole('button', { name: documents('upload.importDocuments') }),
  );
  await user.click(
    await screen.findByRole('menuitem', { name: documents(source.menuItem) }),
  );
  await source.browse(user);
  await user.click(
    await screen.findByRole('checkbox', {
      name: documents('aria.selectFolder', { name: FOLDER.name }),
    }),
  );
  expect(
    screen.getByRole('checkbox', {
      name: documents('aria.selectFolder', { name: FOLDER.name }),
    }),
  ).toBeChecked();
}

async function pendingImport(source: Source, locale: ShippedLocale = 'en') {
  listingsAnswer();
  let answer!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    answer = resolve;
  });
  const importing = vi
    .spyOn(WRITE_ADAPTERS[source.importer], 'run')
    .mockImplementation(async () => pending);
  const view = await renderMenu(locale);
  await importFolder(view.user, source);
  await waitFor(() => expect(importing).toHaveBeenCalledTimes(1));
  return {
    ...view,
    settle: async (result: unknown) => {
      await act(async () => {
        answer(result);
        await pending;
      });
    },
  };
}

const interruptedAnswer = (source: Source) => ({
  success: false,
  results: [imported(FILES[0].name, 0)],
  totalFiles: 4,
  successCount: 1,
  skippedCount: 0,
  error: source.lapse,
});

describe.each(SOURCES)(
  'the $source import after its picker is dismissed',
  (source) => {
    it.each(SHIPPED_LOCALES)(
      'preserves a replacement selection and reports a lapsed grant once (%s)',
      async (locale) => {
        const { user, settle } = await pendingImport(source, locale);
        await dismissImport(user, source);
        await openSelectedPicker(user, source);
        await settle(interruptedAnswer(source));
        expect(
          screen.queryByRole('dialog', {
            name: documents(`${source.ns}.reconnect`),
          }),
        ).toBeNull();
        expect(
          screen.getByRole('checkbox', {
            name: documents('aria.selectFolder', { name: FOLDER.name }),
          }),
        ).toBeChecked();
        expect(shownToasts()).toHaveLength(2);
        expect(shownToasts()[1]).toEqual({
          title: documents(`${source.ns}.reconnect`),
          description: documents('cloudImport.importInterrupted', {
            provider: source.provider,
            imported: 1,
            total: 4,
          }),
          variant: 'warning',
        });
      },
    );

    it.each(['completed', 'partial', 'failed'] as const)(
      'reports a %s background result once without closing the replacement',
      async (kind) => {
        const { user, settle } = await pendingImport(source);
        await dismissImport(user, source);
        await openSelectedPicker(user, source);
        await settle({
          success: kind === 'completed',
          results:
            kind === 'completed'
              ? FILES.map((file, index) => imported(file.name, index))
              : FILES.map((file, index) =>
                  kind === 'partial' && index === 0
                    ? imported(file.name, index)
                    : { fileName: file.name, status: 'error' },
                ),
          totalFiles: 4,
          successCount: kind === 'completed' ? 4 : kind === 'partial' ? 1 : 0,
          skippedCount: 0,
        });
        expect(
          screen.getByRole('checkbox', {
            name: documents('aria.selectFolder', { name: FOLDER.name }),
          }),
        ).toBeChecked();
        expect(shownToasts()).toHaveLength(2);
        expect(shownToasts()[1]?.variant).toBe(
          kind === 'completed'
            ? 'success'
            : kind === 'partial'
              ? 'warning'
              : 'destructive',
        );
      },
    );

    it('leaves the other provider picker open when the old grant answer arrives', async () => {
      const { user, settle } = await pendingImport(source);
      await dismissImport(user, source);
      const next = source.ns === 'googledrive' ? SOURCES[0] : SOURCES[2];
      await openSelectedPicker(user, next);
      await settle(interruptedAnswer(source));
      expect(
        screen.queryByRole('dialog', {
          name: documents(`${source.ns}.reconnect`),
        }),
      ).toBeNull();
      expect(
        screen.getByRole('checkbox', {
          name: documents('aria.selectFolder', { name: FOLDER.name }),
        }),
      ).toBeChecked();
      expect(shownToasts()).toHaveLength(2);
    });

    it('reports a lapsed grant once after dismissal without reopening a dialog', async () => {
      const { user, settle } = await pendingImport(source);
      await dismissImport(user, source);
      await settle(interruptedAnswer(source));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(shownToasts()).toHaveLength(2);
      expect(shownToasts()[1]?.title).toBe(documents(`${source.ns}.reconnect`));
    });

    it('reports a late folder-walk refusal once and leaves the replacement selected', async () => {
      let answer!: (value: unknown) => void;
      const pending = new Promise((resolve) => {
        answer = resolve;
      });
      const listings = listingsAnswer(async () => pending);
      const importing = importAnswers(source.importer, {});
      const { user } = await renderMenu();
      await importFolder(user, source);
      await waitFor(() =>
        expect(listings.get(source.walk)).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: FOLDER.id }),
          expect.any(Object),
        ),
      );
      // The walk precedes the started notice, so one Escape dismisses the picker.
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await openSelectedPicker(user, source);
      await act(async () => {
        answer({ success: false, error: source.lapse });
        await pending;
      });
      expect(
        screen.getByRole('checkbox', {
          name: documents('aria.selectFolder', { name: FOLDER.name }),
        }),
      ).toBeChecked();
      expect(
        screen.queryByRole('dialog', {
          name: documents(`${source.ns}.reconnect`),
        }),
      ).toBeNull();
      expect(importing).not.toHaveBeenCalled();
      expect(shownToasts()).toEqual([
        {
          title: documents(`${source.ns}.reconnect`),
          description: documents('cloudImport.importInterrupted', {
            provider: source.provider,
            imported: 0,
          }),
          variant: 'destructive',
        },
      ]);
    });
  },
);

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

// Unmount first: the app shell still applying the saved language would
// otherwise switch it back after the reset.
afterEach(async () => {
  cleanup();
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

// A grant that ended while the files came in used to read "Import failed"
// with a generic line, the files already imported unsaid. It lands in the
// connect dialog now, with the count and no toast, as a lapsed grant on a
// listing does.
describe.each(SOURCES)(
  'the $source import when access ends part-way',
  (source) => {
    it.each(SHIPPED_LOCALES)(
      'opens the connect dialog with the count, and no toast (%s)',
      async (locale) => {
        listingsAnswer();
        importAnswers(source.importer, {
          success: false,
          results: FILES.slice(0, 2).map((file, index) =>
            imported(file.name, index),
          ),
          totalFiles: 4,
          successCount: 2,
          failedCount: 0,
          skippedCount: 0,
          error: source.lapse,
        });
        const { user } = await renderMenu(locale);

        await importFolder(user, source);

        const dialog = await screen.findByRole('dialog', {
          name: documents(`${source.ns}.reconnect`),
        });
        const said = documents('cloudImport.importInterrupted', {
          provider: source.provider,
          imported: 2,
          total: 4,
        });
        expect(dialog).toHaveAccessibleDescription(said);
        if (locale !== 'en') {
          expect(said).not.toBe(
            i18n.t('cloudImport.importInterrupted', {
              ns: 'documents',
              lng: 'en',
              provider: source.provider,
              imported: 2,
              total: 4,
            }),
          );
        }
        expect(
          within(dialog).getByText(
            documents('cloudImport.reconnectToImportRest'),
          ),
        ).toBeVisible();
        expect(
          within(dialog).getByRole('button', {
            name: documents(`${source.ns}.reconnect`),
          }),
        ).toBeEnabled();
        // The picker is gone, and the one toast the import raised, "Import
        // started", is taken down: the dialog is the only report.
        expect(
          screen.queryByRole('checkbox', {
            name: documents('aria.selectFolder', { name: FOLDER.name }),
          }),
        ).not.toBeInTheDocument();
        expect(shownToasts()).toEqual([
          {
            title: documents(`${source.ns}.importStarted`),
            description: documents(`${source.ns}.importingItems`, {
              count: 4,
            }),
            variant: undefined,
          },
        ]);
        await waitFor(() =>
          expect(
            screen.queryByText(documents(`${source.ns}.importStarted`)),
          ).not.toBeInTheDocument(),
        );
        expect(JSON.stringify(shownToasts())).not.toContain('not authorized');
      },
    );

    // The grant already gone when the import door starts: nothing came in,
    // and the dialog knows how many files the import set out to bring.
    it('says that nothing was imported when the grant is gone as the import starts', async () => {
      listingsAnswer();
      importAnswers(source.importer, {
        success: false,
        results: [],
        totalFiles: 4,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        error: source.lapse,
      });
      const { user } = await renderMenu();

      await importFolder(user, source);

      const dialog = await screen.findByRole('dialog', {
        name: documents(`${source.ns}.reconnect`),
      });
      expect(dialog).toHaveAccessibleDescription(
        documents('cloudImport.importInterrupted', {
          provider: source.provider,
          imported: 0,
          total: 4,
        }),
      );
      expect(shownToasts().map((shown) => shown.title)).toEqual([
        documents(`${source.ns}.importStarted`),
      ]);
    });

    it('says that nothing was imported when access ends during the folder walk', async () => {
      const runs = listingsAnswer(async () => ({
        success: false,
        error: source.lapse,
      }));
      const importing = importAnswers(source.importer, {});
      const { user } = await renderMenu();

      await importFolder(user, source);

      const dialog = await screen.findByRole('dialog', {
        name: documents(`${source.ns}.reconnect`),
      });
      expect(dialog).toHaveAccessibleDescription(
        documents('cloudImport.importInterrupted', {
          provider: source.provider,
          imported: 0,
        }),
      );
      expect(runs.get(source.walk)).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: FOLDER.id }),
        expect.anything(),
      );
      expect(importing).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });
  },
);

// A sync import cut short the same way: the connect dialog, never a toast.
describe.each(SOURCES.filter((source) => source.source !== 'SharePoint'))(
  'the $source sync import when access ends part-way',
  (source) => {
    it('opens the connect dialog with the count, and no toast', async () => {
      listingsAnswer();
      importAnswers(source.importer, {
        success: false,
        results: FILES.slice(0, 1).map((file, index) =>
          imported(file.name, index),
        ),
        totalFiles: 4,
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        error: source.lapse,
      });
      const { user } = await renderMenu();

      await importFolder(user, source, 'sync');

      const dialog = await screen.findByRole('dialog', {
        name: documents(`${source.ns}.reconnect`),
      });
      expect(dialog).toHaveAccessibleDescription(
        documents('cloudImport.importInterrupted', {
          provider: source.provider,
          imported: 1,
          total: 4,
        }),
      );
      expect(shownToasts().map((shown) => shown.title)).toEqual([
        documents(`${source.ns}.syncStarted`),
      ]);
    });
  },
);

// An import where some files failed for another reason used to read "Import
// failed" whole. It is one warning now, counted, with the first failure's
// words when it has any.
describe.each(SOURCES)('the $source import that brings in part', (source) => {
  const partly = (failure: Record<string, unknown>) => ({
    success: false,
    results: [
      ...FILES.slice(0, 3).map((file, index) => imported(file.name, index)),
      { fileId: 'file-4', fileName: 'report.mov', status: 'error', ...failure },
    ],
    totalFiles: 4,
    successCount: 3,
    failedCount: 1,
    skippedCount: 0,
  });

  it.each(SHIPPED_LOCALES)(
    "says so in one warning, with the first failure's words (%s)",
    async (locale) => {
      listingsAnswer();
      importAnswers(
        source.importer,
        partly({
          error: CAP,
          reason: { code: 'FILE_SIZE_INVALID', message: CAP },
        }),
      );
      const { user } = await renderMenu(locale);

      await importFolder(user, source);

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(shownToasts()[1]).toEqual({
        title: documents('cloudImport.importedPartial', {
          imported: 3,
          total: 4,
        }),
        description: documents('cloudImport.failedFileDetail', {
          name: 'report.mov',
          reason: CAP,
        }),
        variant: 'warning',
      });
      expect(
        await screen.findByText(
          documents('cloudImport.importedPartial', { imported: 3, total: 4 }),
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole('dialog', {
          name: documents(`${source.ns}.reconnect`),
        }),
      ).toBeNull();
    },
  );

  it('keeps the counts alone when the failure was a fault', async () => {
    listingsAnswer();
    importAnswers(
      source.importer,
      partly({
        error:
          'Failed to download file: 503 {"error":{"code":"serviceNotAvailable"}}',
      }),
    );
    const { user } = await renderMenu();

    await importFolder(user, source);

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(shownToasts()[1]).toEqual({
      title: documents('cloudImport.importedPartial', {
        imported: 3,
        total: 4,
      }),
      description: undefined,
      variant: 'warning',
    });
    expect(JSON.stringify(shownToasts())).not.toContain('503');
  });

  // The same selection imported again after reconnecting: the files the
  // first run brought in come back skipped, and count as imported.
  it('counts the files a re-run skipped as imported', async () => {
    listingsAnswer();
    importAnswers(source.importer, {
      success: true,
      results: FILES.map((file, index) => ({
        ...imported(file.name, index),
        status: index < 2 ? 'skipped' : 'success',
      })),
      totalFiles: 4,
      successCount: 2,
      failedCount: 0,
      skippedCount: 2,
    });
    const { user } = await renderMenu();

    await importFolder(user, source);

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(shownToasts()[1]).toEqual({
      title: documents(`${source.ns}.importCompleted`),
      description: documents(`${source.ns}.filesImportedCount`, {
        count: 4,
        total: 4,
      }),
      variant: 'success',
    });
  });
});

// Nothing came in: the destructive "Import failed" stays, and says why with
// the same rule — the first failure's words, else the counts.
describe.each(SOURCES)(
  'the $source import that brings in nothing',
  (source) => {
    const failing = (first: Record<string, unknown>) => ({
      success: false,
      results: [
        {
          fileId: 'file-1',
          fileName: 'agenda.docx',
          status: 'error',
          ...first,
        },
        ...FILES.slice(1).map((file) => ({
          fileId: file.id,
          fileName: file.name,
          status: 'error',
          error: 'Failed to get file metadata: 429 {"error":{}}',
        })),
      ],
      totalFiles: 4,
      successCount: 0,
      failedCount: 4,
      skippedCount: 0,
    });

    it("says why with the first failure's words", async () => {
      listingsAnswer();
      importAnswers(
        source.importer,
        failing({
          error: CAP,
          reason: { code: 'FILE_SIZE_INVALID', message: CAP },
        }),
      );
      const { user } = await renderMenu();

      await importFolder(user, source);

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(shownToasts()[1]).toEqual({
        title: documents(`${source.ns}.importFailed`),
        description: documents('cloudImport.failedFileDetail', {
          name: 'agenda.docx',
          reason: CAP,
        }),
        variant: 'destructive',
      });
    });

    it("keeps the counts alone when the failure was a fault, never the provider's answer", async () => {
      listingsAnswer();
      importAnswers(
        source.importer,
        failing({
          error:
            'Failed to get file metadata: 403 {"error":{"code":"accessDenied"}}',
        }),
      );
      const { user } = await renderMenu();

      await importFolder(user, source);

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(shownToasts()[1]).toEqual({
        title: documents(`${source.ns}.importFailed`),
        description: documents(`${source.ns}.filesImportedCount`, {
          count: 0,
          total: 4,
        }),
        variant: 'destructive',
      });
      expect(JSON.stringify(shownToasts())).not.toContain('metadata');
    });
  },
);
