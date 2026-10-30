import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { TrashPage } from './trash-page';

// #4840: every refused restore read "Couldn't restore this record." — a
// contact whose email another contact now holds, and a row already restored
// or deleted alike — and the dialog stayed open on a row that was gone. The
// restore lane runs for real here: `useRestoreSoftDeletedRow`, the adapter
// row and its `refusalInvalidates`, `backendFetch`, against a closed
// synthetic transport.

const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast,
  useToast: () => ({ toast }),
}));
vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
// The page is admin-only; the reader here is an admin.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const FIRST_PAGE = /^GET \/api\/app\/governance\/trash\?limit=20&orgId=org-1$/;
const RESTORE_CALL =
  /^POST \/api\/app\/governance\/trash\/restore\?orgId=org-1$/;

const TRASHED_AT = 1_789_450_000_000;

const CONTACT = {
  resourceType: 'contact',
  id: 'contact-1',
  status: 'trashed',
  statusChangedAt: TRASHED_AT,
  createdAt: TRASHED_AT,
  displayName: 'Ada Lovelace',
  ownerId: 'user-1',
  ownerName: 'Grace Hopper',
};
const DOCUMENT = {
  resourceType: 'document',
  id: 'document-1',
  status: 'trashed',
  statusChangedAt: TRASHED_AT - 1,
  createdAt: TRASHED_AT - 1,
  displayName: 'Quarterly report',
  ownerId: 'user-1',
  ownerName: 'Grace Hopper',
};

/** The words each shipped locale shows, pinned here so a missing
 * translation fails. */
const RESTORE: Record<ShippedLocale, string> = {
  en: 'Restore',
  de: 'Wiederherstellen',
  fr: 'Restaurer',
};
const RESTORE_FAILED: Record<ShippedLocale, string> = {
  en: "Couldn't restore",
  de: 'Wiederherstellung fehlgeschlagen',
  fr: 'Échec de la restauration',
};
const DUPLICATE_EMAIL: Record<ShippedLocale, string> = {
  en: 'A contact with this email already exists',
  de: 'Ein Kontakt mit dieser E-Mail existiert bereits',
  fr: 'Un contact avec cette adresse email existe déjà',
};
const GONE: Record<ShippedLocale, string> = {
  en: 'This record is no longer in Trash. It was restored or permanently deleted in the meantime.',
  de: 'Dieser Datensatz ist nicht mehr im Papierkorb. Er wurde inzwischen wiederhergestellt oder endgültig gelöscht.',
  fr: "Cet enregistrement n'est plus dans la corbeille. Il a été restauré ou supprimé définitivement entre-temps.",
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/governance/trash',
  );
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  toast.mockReset();
  await forgetSavedLocale();
});

/** The door lists `rows()` as they stand when asked. */
function listing(rows: () => object[]) {
  backend.on(FIRST_PAGE, () =>
    Response.json({ rows: rows(), nextCursor: null }),
  );
}

function renderTrash() {
  return render(
    <QueryClientProvider client={client}>
      <TrashPage organizationId="org-1" />
    </QueryClientProvider>,
  );
}

/** Restore `name` and confirm in the dialog; answers the dialog. */
async function restore(
  user: ReturnType<typeof renderTrash>['user'],
  name: string,
  locale: ShippedLocale,
): Promise<HTMLElement> {
  const row = (await screen.findByText(name)).closest('tr');
  if (row === null) throw new Error(`${name} is in no row`);
  await user.click(within(row).getByRole('button', { name: RESTORE[locale] }));
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: RESTORE[locale] }),
  );
  return dialog;
}

describe('TrashPage when a restore is refused', { timeout: 30_000 }, () => {
  it.each(SHIPPED_LOCALES)(
    'says a contact’s email is taken in the reader’s language, and keeps the list (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      listing(() => [CONTACT, DOCUMENT]);
      // Another contact took Ada's address while hers was in the trash.
      backend.on(RESTORE_CALL, () =>
        Response.json({ error: 'CONTACT_DUPLICATE_EMAIL' }, { status: 409 }),
      );
      const { user } = renderTrash();

      const dialog = await restore(user, 'Ada Lovelace', locale);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: RESTORE_FAILED[locale],
          description: DUPLICATE_EMAIL[locale],
          variant: 'destructive',
        }),
      );
      expect(toast).toHaveBeenCalledTimes(1);
      expect(backend.count(RESTORE_CALL)).toBe(1);
      // The contact is still in the trash: the dialog stays for Cancel, and
      // the list is not read again.
      expect(dialog).toBeInTheDocument();
      expect(backend.count(FIRST_PAGE)).toBe(1);
    },
  );

  it.each(SHIPPED_LOCALES)(
    'closes the dialog on a row that left the trash, says so, and re-reads the list (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      let restoredElsewhere = false;
      listing(() => (restoredElsewhere ? [CONTACT] : [CONTACT, DOCUMENT]));
      // Another admin restored the report after this list was read.
      backend.on(RESTORE_CALL, () => {
        restoredElsewhere = true;
        return Response.json({ error: 'ROW_NOT_FOUND' }, { status: 404 });
      });
      const { user } = renderTrash();

      await restore(user, 'Quarterly report', locale);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: RESTORE_FAILED[locale],
          description: GONE[locale],
          variant: 'destructive',
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(screen.queryByText('Quarterly report')).not.toBeInTheDocument(),
      );
      expect(backend.count(FIRST_PAGE)).toBe(2);
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
      expect(toast).toHaveBeenCalledTimes(1);
    },
  );
});
