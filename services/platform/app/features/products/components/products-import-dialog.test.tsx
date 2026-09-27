// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'products.import.success',
        variant: 'success',
      }),
    );
    expect(onSuccess).toHaveBeenCalled();
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
    const { onClose } = await importFile();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
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
});
