import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen } from '@/tests/utils/render';

import { GoogleDriveImportDialog } from './google-drive-import-dialog';
import { OneDriveImportDialog } from './onedrive-import-dialog';

// The import runs for real — the import hooks, `useBackendAction`, the
// adapter row, `backendFetch` — against the session door's own 401, and the
// real toast renders, so the test counts every toast a refused import
// raises, the hook's default toast included.
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
// A connected account whose top folder holds the one item a case selects.
const listing = vi.hoisted(() => ({
  data: { items: [] as unknown[], truncated: false },
  isLoading: false,
  error: null,
}));
vi.mock('../hooks/queries', () => ({
  useCloudImportAuthorizationStatus: () => ({
    data: { status: 'active' },
    isLoading: false,
    error: null,
  }),
  useGoogleDriveFiles: () => listing,
  useOneDriveFiles: () => listing,
  useSharePointSites: () => ({ data: [], isLoading: false }),
  useSharePointDrives: () => ({ data: [], isLoading: false }),
  useSharePointFiles: () => ({
    data: { items: [], truncated: false },
    isLoading: false,
  }),
}));

const documents = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'documents', ...options });

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json(LAPSED_SESSION_ANSWER.body, {
      status: LAPSED_SESSION_ANSWER.status,
    }),
  );
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

/** Imported as it is: the import is the only request. */
const FILE = { id: 'file-1', name: 'notes.docx', size: 10, isFolder: false };
/** Walked first: its listing is the first request, and meets the lapse
 * before the import starts. */
const FOLDER = { id: 'folder-1', name: 'Meetings', size: 0, isFolder: true };

const DIALOGS = [
  {
    provider: 'Google Drive',
    Dialog: GoogleDriveImportDialog,
    ns: 'googledrive',
  },
  { provider: 'Microsoft 365', Dialog: OneDriveImportDialog, ns: 'onedrive' },
] as const;

// The import hook's default toast reported the refusal a second time,
// between the dialog's "Import started" and its own failure toast, and so did
// the folder walk's listing action.
describe.each(DIALOGS)(
  'the $provider import after a lapsed session',
  ({ Dialog, ns }) => {
    it.each(
      SHIPPED_LOCALES.flatMap((locale) => [
        { locale, selection: 'a file', item: FILE, walked: false },
        { locale, selection: 'a folder', item: FOLDER, walked: true },
      ]),
    )(
      'says once that the session ended, for $selection ($locale)',
      async ({ locale, item, walked }) => {
        listing.data.items = [item];
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        const { user } = render(
          <QueryClientProvider client={new QueryClient()}>
            <Dialog open onOpenChange={vi.fn()} organizationId="org-1" />
            <Toaster />
          </QueryClientProvider>,
        );

        await user.click(
          screen.getByRole('checkbox', {
            name: documents(
              item.isFolder ? 'aria.selectFolder' : 'aria.selectFile',
              { name: item.name },
            ),
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

        expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
        expect(
          vi.mocked(toast).mock.calls.map(([shown]) => ({
            title: shown.title,
            description: shown.description,
            variant: shown.variant,
          })),
        ).toEqual([
          ...(walked
            ? []
            : [
                {
                  title: documents(`${ns}.importStarted`),
                  description: documents(`${ns}.importingItems`, { count: 1 }),
                  variant: undefined,
                },
              ]),
          {
            title: documents(`${ns}.importFailed`),
            description: SESSION_ENDED[locale],
            variant: 'destructive',
          },
        ]);
      },
    );
  },
);
