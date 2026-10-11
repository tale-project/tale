// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHIPPED_LOCALES,
  type ShippedLocale,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';

// The import dialog as the Add menu opens it. The menu closes the dialog
// through its `onSuccess`, so a partial import (some rows landed, some were
// refused) must not reach it: the dialog stays open over the refused rows,
// the toast says the import was partial, and the user can fix those lines
// and import them again (#3827). A clean import still closes it.

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// The manual-entry dialog is the menu's other door; the import never opens it.
vi.mock('./contact-create-dialog', () => ({
  ContactCreateDialog: () => null,
}));

const parseFile = vi.fn();
vi.mock('@/app/hooks/use-file-import', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/hooks/use-file-import')>();
  return { ...actual, useFileImport: () => ({ parseFile }) };
});

const bulkCreate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useBulkCreateContacts: () => ({ mutateAsync: bulkCreate }),
}));

import { ContactsActionMenu } from './contacts-action-menu';

const toastMock = vi.mocked(toast);

/** What each shipped locale shows along the way. */
const COPY = {
  en: {
    menu: 'Add contact',
    fromDevice: 'From your device',
    dialog: 'Upload contacts',
    importButton: 'Import',
    partial: 'Partially imported',
    partialCounts: 'Imported 1 contacts, 1 failed',
    success: 'Imported',
    successCounts: 'Imported 2 contacts',
    none: 'No contacts were imported',
    oneRowRefused: '1 row was not imported',
    twoRowsRefused: '2 rows were not imported',
    duplicateRow: 'Row 3: A contact with this email already exists',
  },
  de: {
    menu: 'Kontakt hinzufügen',
    fromDevice: 'Von deinem Gerät',
    dialog: 'Kontakte hochladen',
    importButton: 'Importieren',
    partial: 'Teilweise importiert',
    partialCounts: '1 Kontakte importiert, 1 fehlgeschlagen',
    success: 'Import',
    successCounts: '2 Kontakte importiert',
    none: 'Es wurden keine Kontakte importiert',
    oneRowRefused: '1 Zeile wurde nicht importiert',
    twoRowsRefused: '2 Zeilen wurden nicht importiert',
    duplicateRow: 'Zeile 3: Ein Kontakt mit dieser E-Mail existiert bereits',
  },
  fr: {
    menu: 'Ajouter un contact',
    fromDevice: 'Depuis ton appareil',
    dialog: 'Téléverser des contacts',
    importButton: 'Importer',
    partial: 'Importation partielle',
    partialCounts: '1 contacts importés, 1 échoué(s)',
    success: 'Importé',
    successCounts: '2 contacts importés',
    none: "Aucun contact n'a été importé",
    oneRowRefused: "1 ligne n'a pas été importée",
    twoRowsRefused: "2 lignes n'ont pas été importées",
    duplicateRow: 'Ligne 3 : Un contact avec cette adresse email existe déjà',
  },
} as const satisfies Record<ShippedLocale, Record<string, string>>;

const TWO_ROWS = {
  data: [
    { email: 'ada@example.test', source: 'file_upload' },
    { email: 'grace@example.test', source: 'file_upload' },
  ],
  rows: [2, 3],
  errors: [],
  rowErrors: [],
};

function duplicateAt(index: number) {
  return {
    index,
    error: 'Contact already exists',
    errorCode: 'CONTACT_DUPLICATE_EMAIL',
    contact: {},
  };
}

/** Intl and the French colon use non-breaking spaces. */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s/gu, ' ');
}

describe.each(SHIPPED_LOCALES)(
  'ContactsActionMenu import from a file (%s)',
  (locale) => {
    const copy = COPY[locale];

    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    async function importTwoRows() {
      const { user } = render(<ContactsActionMenu organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: copy.menu }));
      await user.click(
        await screen.findByRole('menuitem', { name: copy.fromDevice }),
      );
      const dialog = await screen.findByRole('dialog', { name: copy.dialog });
      const input = document.getElementById('contact-file-upload');
      if (!(input instanceof HTMLInputElement)) throw new Error('no input');
      await user.upload(input, new File(['email'], 'contacts.csv'));
      await user.click(
        within(dialog).getByRole('button', { name: copy.importButton }),
      );
      return { user, dialog, input };
    }

    /** The refused-rows banner (the form's own note is an alert too). */
    async function rowErrorsAlert(title: string): Promise<HTMLElement> {
      const heading = await screen.findByText(title);
      const alert = heading.closest('[role="alert"]');
      if (!(alert instanceof HTMLElement)) throw new Error('no banner');
      return alert;
    }

    it('keeps the dialog open over the refused rows after a partial import', async () => {
      parseFile.mockResolvedValue(TWO_ROWS);
      bulkCreate.mockResolvedValue({
        success: 1,
        failed: 1,
        errors: [duplicateAt(1)],
      });
      const { user, dialog, input } = await importTwoRows();

      const alert = await rowErrorsAlert(copy.oneRowRefused);
      expect(
        within(alert)
          .getAllByRole('listitem')
          .map((item) => plain(item.textContent)),
      ).toEqual([copy.duplicateRow]);
      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: copy.partial,
          description: copy.partialCounts,
          variant: 'warning',
        }),
      );
      expect(dialog).toBeInTheDocument();

      // Fixing the refused line and importing it again lands it and closes.
      parseFile.mockResolvedValue({
        ...TWO_ROWS,
        data: [{ email: 'grace@example.org', source: 'file_upload' }],
        rows: [2],
      });
      bulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
      await user.upload(input, new File(['email'], 'fixed.csv'));
      await user.click(
        within(dialog).getByRole('button', { name: copy.importButton }),
      );
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(bulkCreate).toHaveBeenCalledTimes(2);
    });

    it('closes after a clean import', async () => {
      parseFile.mockResolvedValue(TWO_ROWS);
      bulkCreate.mockResolvedValue({ success: 2, failed: 0, errors: [] });
      const { dialog } = await importTwoRows();

      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(toastMock).toHaveBeenCalledWith({
        title: copy.success,
        description: copy.successCounts,
        variant: 'success',
      });
    });

    it('stays open over every row when none landed', async () => {
      parseFile.mockResolvedValue(TWO_ROWS);
      bulkCreate.mockResolvedValue({
        success: 0,
        failed: 2,
        errors: [duplicateAt(0), duplicateAt(1)],
      });
      const { dialog } = await importTwoRows();

      const alert = await rowErrorsAlert(copy.twoRowsRefused);
      expect(within(alert).getAllByRole('listitem')).toHaveLength(2);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: copy.none, variant: 'destructive' }),
      );
      expect(dialog).toBeInTheDocument();
    });
  },
);
