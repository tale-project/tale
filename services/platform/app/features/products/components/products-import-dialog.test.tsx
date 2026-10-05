// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';

// The dialog's row accounting: a row the parser refused and a row the door
// refused are listed together by spreadsheet line, the rest of the file
// lands, and the dialog stays open over the list so the file can be fixed.

// Params are appended (`key row=3 message=…`) so a line's row and reason
// are assertable through the key.
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params
        ? `${ns}.${key} ${Object.entries(params)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(' ')}`
        : `${ns}.${key}`,
  }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
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

import { ProductsImportDialog } from './products-import-dialog';

const toastMock = vi.mocked(toast);

/** The refused-rows banner (the form's own note is an alert too). */
async function rowErrorsAlert(): Promise<HTMLElement> {
  const title = await screen.findByText('common.import.rowErrorsTitle', {
    exact: false,
  });
  const alert = title.closest('[role="alert"]');
  if (!(alert instanceof HTMLElement)) throw new Error('no banner');
  return alert;
}

async function importFile(onClose = vi.fn(), onSuccess = vi.fn()) {
  const { user } = render(
    <ProductsImportDialog
      isOpen={true}
      onClose={onClose}
      organizationId="org-1"
      onSuccess={onSuccess}
    />,
  );
  const input = document.getElementById('product-file-upload');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  await user.upload(input, new File(['name,price'], 'products.csv'));
  await user.click(
    screen.getByRole('button', { name: 'common.actions.import' }),
  );
  return { user, onClose, onSuccess };
}

describe('ProductsImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the refused rows by spreadsheet line and keeps the dialog open over them', async () => {
    parseFile.mockResolvedValue({
      data: [{ name: 'Kettle' }, { name: 'Mixer', currency: 'EUR' }],
      rows: [2, 5],
      errors: [],
      rowErrors: [{ row: 3, message: 'price: must be a number' }],
    });
    bulkCreate.mockResolvedValue({
      success: 1,
      failed: 1,
      errors: [
        {
          index: 1,
          error: 'currency: is not an ISO 4217 currency code',
          errorCode: 'INVALID_BODY',
          issues: [
            { path: 'currency', message: 'is not an ISO 4217 currency code' },
          ],
          product: {},
        },
      ],
    });
    const { onClose, onSuccess } = await importFile();

    await waitFor(() =>
      expect(bulkCreate).toHaveBeenCalledWith({
        organizationId: 'org-1',
        products: [{ name: 'Kettle' }, { name: 'Mixer', currency: 'EUR' }],
      }),
    );
    const alert = await rowErrorsAlert();
    const items = within(alert).getAllByRole('listitem');
    // Line 3 was refused by the parser, line 5 (sent at index 1) by the door.
    expect(items.map((item) => item.textContent)).toEqual([
      'common.import.rowError row=3 message=price: must be a number',
      'common.import.rowError row=5 message=currency: is not an ISO 4217 currency code',
    ]);
    expect(alert).toHaveTextContent('common.import.rowErrorsTitle count=2');
    // A partial import is not a success: the action menu closes the dialog
    // through `onSuccess`, which would take the list with it (#3827).
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'common.import.partialTitle',
        description: 'products.import.successDescription success=1 failed=2',
        variant: 'warning',
      }),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after a clean import', async () => {
    parseFile.mockResolvedValue({
      data: [{ name: 'Kettle' }],
      rows: [2],
      errors: [],
      rowErrors: [],
    });
    bulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
    const { onClose, onSuccess } = await importFile();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'products.import.success',
        variant: 'success',
      }),
    );
    expect(
      screen.queryByText('common.import.rowErrorsTitle', { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('sends nothing and names the first line when every row was refused', async () => {
    parseFile.mockResolvedValue({
      data: [],
      rows: [],
      errors: [],
      rowErrors: [{ row: 2, message: 'name: must not be blank' }],
    });
    await importFile();
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'products.noneImported',
          variant: 'destructive',
        }),
      ),
    );
    expect(bulkCreate).not.toHaveBeenCalled();
    expect(await rowErrorsAlert()).toHaveTextContent('name: must not be blank');
  });

  // The door refuses a list over 1,000 rows whole, with a 400 that names no
  // row; the dialog asks for a split instead of sending it.
  function parsedRows(count: number) {
    return {
      data: Array.from({ length: count }, (_, i) => ({ name: `P${i}` })),
      rows: Array.from({ length: count }, (_, i) => i + 2),
      errors: [],
      rowErrors: [],
    };
  }

  it("refuses a file over the door's row cap before sending it", async () => {
    parseFile.mockResolvedValue(parsedRows(1001));
    const { onClose } = await importFile();
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'products.import.error',
        description: 'common.import.tooManyRows count=1001 max=1000',
        variant: 'destructive',
      }),
    );
    expect(bulkCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends a file of exactly the row cap', async () => {
    parseFile.mockResolvedValue(parsedRows(1000));
    bulkCreate.mockResolvedValue({ success: 1000, failed: 0, errors: [] });
    const { onClose } = await importFile();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bulkCreate).toHaveBeenCalledTimes(1);
    expect(bulkCreate.mock.calls[0]?.[0].products).toHaveLength(1000);
  });
});

// The session door's 401 names the REST API in English; the person whose
// session ended reads why in their own language, under the localized title.
describe.each(SHIPPED_LOCALES)(
  'ProductsImportDialog after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session has ended under the import error title', async () => {
      parseFile.mockResolvedValue({
        data: [{ name: 'Kettle' }],
        rows: [2],
        errors: [],
        rowErrors: [],
      });
      bulkCreate.mockImplementation(lapsedSessionRefusal);
      const { onClose } = await importFile();

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: 'products.import.error',
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(toastMock.mock.calls)).not.toContain('API key');
      expect(onClose).not.toHaveBeenCalled();
    });
  },
);
