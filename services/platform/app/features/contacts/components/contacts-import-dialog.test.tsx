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

// The same row accounting the products import has: refused rows listed by
// spreadsheet line — a duplicate with its localized sentence, a refused
// field with the door's `field: reason` — and the rest of the file lands.

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
  useBulkCreateContacts: () => ({ mutateAsync: bulkCreate }),
}));

import { ImportContactsDialog } from './contacts-import-dialog';

const toastMock = vi.mocked(toast);

async function importFile(onClose = vi.fn()) {
  const { user } = render(
    <ImportContactsDialog
      isOpen={true}
      onClose={onClose}
      organizationId="org-1"
    />,
  );
  const input = document.getElementById('contact-file-upload');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  await user.upload(input, new File(['email'], 'contacts.csv'));
  await user.click(
    screen.getByRole('button', { name: 'contacts.import.import' }),
  );
  return { user, onClose };
}

describe('ImportContactsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists a parser refusal, a duplicate and a refused field by line', async () => {
    parseFile.mockResolvedValue({
      data: [
        { email: 'a@example.test', source: 'file_upload' },
        { email: 'b@example.test', source: 'file_upload' },
      ],
      rows: [2, 4],
      errors: [],
      rowErrors: [{ row: 3, message: 'email: must not be blank' }],
    });
    bulkCreate.mockResolvedValue({
      success: 0,
      failed: 2,
      errors: [
        {
          index: 0,
          error: 'Contact with email a@example.test already exists',
          errorCode: 'CONTACT_DUPLICATE_EMAIL',
          contact: {},
        },
        {
          index: 1,
          error: 'locale: is not a locale',
          errorCode: 'INVALID_BODY',
          issues: [{ path: 'locale', message: 'is not a locale' }],
          contact: {},
        },
      ],
    });
    const { onClose } = await importFile();

    const title = await screen.findByText('common.import.rowErrorsTitle', {
      exact: false,
    });
    const alert = title.closest('[role="alert"]');
    if (!(alert instanceof HTMLElement)) throw new Error('no banner');
    const items = within(alert).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'common.import.rowError row=2 message=contacts.import.errorCodes.duplicate_email',
      'common.import.rowError row=3 message=email: must not be blank',
      'common.import.rowError row=4 message=locale: is not a locale',
    ]);
    expect(alert).toHaveTextContent('common.import.rowErrorsTitle count=3');
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'contacts.import.noneImported',
        variant: 'destructive',
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after a clean import', async () => {
    parseFile.mockResolvedValue({
      data: [{ email: 'a@example.test', source: 'file_upload' }],
      rows: [2],
      errors: [],
      rowErrors: [],
    });
    bulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
    const { onClose } = await importFile();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // The door refuses a list over 1,000 rows whole, with a 400 that names no
  // row; the dialog asks for a split instead of sending it.
  function parsedRows(count: number) {
    return {
      data: Array.from({ length: count }, (_, i) => ({
        email: `c${i}@example.test`,
        source: 'file_upload',
      })),
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
        title: 'contacts.import.error',
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
    expect(bulkCreate.mock.calls[0]?.[0].contacts).toHaveLength(1000);
  });
});

// The session door's 401 names the REST API in English; the person whose
// session ended reads why in their own language, under the localized title.
describe.each(SHIPPED_LOCALES)(
  'ImportContactsDialog after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session has ended under the import error title', async () => {
      parseFile.mockResolvedValue({
        data: [{ email: 'a@example.test', source: 'file_upload' }],
        rows: [2],
        errors: [],
        rowErrors: [],
      });
      bulkCreate.mockImplementation(lapsedSessionRefusal);
      const { onClose } = await importFile();

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: 'contacts.import.error',
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(toastMock.mock.calls)).not.toContain('API key');
      expect(onClose).not.toHaveBeenCalled();
    });
  },
);
