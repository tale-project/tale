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

import { ProductsImportDialog } from './products-import-dialog';

// #4841: a file whose first row lacked a required column was refused with the
// parser's English "Missing required column(s): …" as the toast's title,
// whatever the reader's language, as for a German file headed
// "Name,Preis,Bestand". The real parser, mappers and catalogs run here; only
// the toast and the bulk door are stubbed.

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const bulkCreate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useBulkCreateProducts: () => ({ mutateAsync: bulkCreate }),
}));

const toastMock = vi.mocked(toast);
const catalogs = { en: enMessages, de: deMessages, fr: frMessages };

/** The refusal each shipped locale shows for `Name,Preis,Bestand`: the
 * columns the parser needs by the headers it accepts, and the ones found. */
const REFUSED: Record<ShippedLocale, { title: string; description: string }> = {
  en: {
    title: 'No valid product data found',
    description:
      'This file is missing the columns price, stock. Its columns are name, preis, bestand.',
  },
  de: {
    title: 'Keine gültigen Produktdaten gefunden',
    description:
      'Dieser Datei fehlen die Spalten price, stock. Vorhanden sind die Spalten name, preis, bestand.',
  },
  fr: {
    title: 'Aucune donnée produit valide trouvée',
    description:
      'Ce fichier ne contient pas les colonnes price, stock. Il contient les colonnes name, preis, bestand.',
  },
};

describe.each(SHIPPED_LOCALES)(
  'ProductsImportDialog with missing columns (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it("names the missing and found columns in the reader's language", async () => {
      const onClose = vi.fn();
      const { user } = render(
        <ProductsImportDialog
          isOpen={true}
          onClose={onClose}
          organizationId="org-1"
        />,
      );
      const input = document.getElementById('product-file-upload');
      if (!(input instanceof HTMLInputElement)) {
        throw new Error('no file input');
      }
      await user.upload(
        input,
        new File(['Name,Preis,Bestand\nKessel,12,3\n'], 'produkte.csv', {
          type: 'text/csv',
        }),
      );
      await user.click(
        screen.getByRole('button', {
          name: catalogs[locale].common.actions.import,
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
