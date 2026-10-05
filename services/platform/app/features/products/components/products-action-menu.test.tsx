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
vi.mock('./product-create-dialog', () => ({
  ProductCreateDialog: () => null,
}));

const parseFile = vi.fn();
vi.mock('@/app/hooks/use-file-import', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/hooks/use-file-import')>();
  return { ...actual, useFileImport: () => ({ parseFile }) };
});

const bulkCreate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useBulkCreateProducts: () => ({ mutateAsync: bulkCreate }),
}));

import { ProductsActionMenu } from './products-action-menu';

const toastMock = vi.mocked(toast);

/** The server's own words for a refused field, shown as it sent them. */
const CURRENCY_REFUSAL = 'currency: is not an ISO 4217 currency code';

/** What each shipped locale shows along the way. */
const COPY = {
  en: {
    menu: 'Add product',
    fromDevice: 'From your device',
    dialog: 'Upload products',
    importButton: 'Import',
    partial: 'Partially imported',
    partialCounts: 'Imported 1 products, 1 failed',
    success: 'Import successful',
    successCounts: 'Imported 2 products',
    none: 'No products were imported',
    oneRowRefused: '1 row was not imported',
    twoRowsRefused: '2 rows were not imported',
    refusedRow: `Row 3: ${CURRENCY_REFUSAL}`,
  },
  de: {
    menu: 'Produkt hinzufügen',
    fromDevice: 'Von deinem Gerät',
    dialog: 'Produkte hochladen',
    importButton: 'Importieren',
    partial: 'Teilweise importiert',
    partialCounts: '1 Produkte importiert, 1 fehlgeschlagen',
    success: 'Import',
    successCounts: '2 Produkte importiert',
    none: 'Es wurden keine Produkte importiert',
    oneRowRefused: '1 Zeile wurde nicht importiert',
    twoRowsRefused: '2 Zeilen wurden nicht importiert',
    refusedRow: `Zeile 3: ${CURRENCY_REFUSAL}`,
  },
  fr: {
    menu: 'Ajouter un produit',
    fromDevice: 'Depuis ton appareil',
    dialog: 'Téléverser des produits',
    importButton: 'Importer',
    partial: 'Importation partielle',
    partialCounts: 'Importation réussie de 1 produits, 1 échoué(s)',
    success: 'Importation réussie',
    successCounts: 'Importation réussie de 2 produits',
    none: "Aucun produit n'a été importé",
    oneRowRefused: "1 ligne n'a pas été importée",
    twoRowsRefused: "2 lignes n'ont pas été importées",
    refusedRow: `Ligne 3 : ${CURRENCY_REFUSAL}`,
  },
} as const satisfies Record<ShippedLocale, Record<string, string>>;

const TWO_ROWS = {
  data: [{ name: 'Kettle' }, { name: 'Mixer', currency: 'EURO' }],
  rows: [2, 3],
  errors: [],
  rowErrors: [],
};

function refusedAt(index: number) {
  return {
    index,
    error: CURRENCY_REFUSAL,
    errorCode: 'INVALID_BODY',
    issues: [{ path: 'currency', message: 'is not an ISO 4217 currency code' }],
    product: {},
  };
}

/** Intl and the French colon use non-breaking spaces. */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s/gu, ' ');
}

describe.each(SHIPPED_LOCALES)(
  'ProductsActionMenu import from a file (%s)',
  (locale) => {
    const copy = COPY[locale];

    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    async function importTwoRows() {
      const { user } = render(<ProductsActionMenu organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: copy.menu }));
      await user.click(
        await screen.findByRole('menuitem', { name: copy.fromDevice }),
      );
      const dialog = await screen.findByRole('dialog', { name: copy.dialog });
      const input = document.getElementById('product-file-upload');
      if (!(input instanceof HTMLInputElement)) throw new Error('no input');
      await user.upload(input, new File(['name'], 'products.csv'));
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
        errors: [refusedAt(1)],
      });
      const { user, dialog, input } = await importTwoRows();

      const alert = await rowErrorsAlert(copy.oneRowRefused);
      expect(
        within(alert)
          .getAllByRole('listitem')
          .map((item) => plain(item.textContent)),
      ).toEqual([copy.refusedRow]);
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
        data: [{ name: 'Mixer', currency: 'EUR' }],
        rows: [2],
      });
      bulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
      await user.upload(input, new File(['name'], 'fixed.csv'));
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
        errors: [refusedAt(0), refusedAt(1)],
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
