import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHIPPED_LOCALES,
  type ShippedLocale,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ImportContactsDialog } from './contacts-import-dialog';

// #4841: a file whose first row has no email column was refused with the
// parser's English "Missing required column(s): email. Found columns: …",
// whatever the reader's language, as when a German spreadsheet heads the
// column "E-Mail-Adresse". The real parser, mappers and catalogs run here;
// only the toast and the bulk door are stubbed.

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const bulkCreate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useBulkCreateContacts: () => ({ mutateAsync: bulkCreate }),
}));

const toastMock = vi.mocked(toast);
const catalogs = { en: enMessages, de: deMessages, fr: frMessages };

/** The refusal each shipped locale shows for `E-Mail-Adresse,Name`: the
 * column the parser needs by the header it accepts, and the ones found. */
const REFUSED: Record<ShippedLocale, { title: string; description: string }> = {
  en: {
    title: 'No valid contact data found',
    description:
      'This file is missing the column email. Its columns are e-mail-adresse, name.',
  },
  de: {
    title: 'Keine gültigen Kontaktdaten gefunden',
    description:
      'Dieser Datei fehlt die Spalte email. Vorhanden sind die Spalten e-mail-adresse, name.',
  },
  fr: {
    title: 'Aucune donnée de contact valide trouvée',
    description:
      'Ce fichier ne contient pas la colonne email. Il contient les colonnes e-mail-adresse, name.',
  },
};

describe.each(SHIPPED_LOCALES)(
  'ImportContactsDialog with a missing column (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it("names the missing and found columns in the reader's language", async () => {
      const onClose = vi.fn();
      const { user } = render(
        <ImportContactsDialog
          isOpen={true}
          onClose={onClose}
          organizationId="org-1"
        />,
      );
      const input = document.getElementById('contact-file-upload');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('no file input');
      }
      await user.upload(
        input,
        new File(
          ['E-Mail-Adresse,Name\nanna@example.test,Anna\n'],
          'kontakte.csv',
          { type: 'text/csv' },
        ),
      );
      await user.click(
        screen.getByRole('button', {
          name: catalogs[locale].contacts.import.import,
        }),
      );

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          ...REFUSED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(toastMock.mock.calls)).not.toContain(
        'Missing required column',
      );
      expect(bulkCreate).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  },
);
