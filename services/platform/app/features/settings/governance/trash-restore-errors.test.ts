import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAdapted } from '@/app/lib/backend/adapters';
import { settingsWriteAdapters } from '@/app/lib/backend/settings';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { mapTrashRestoreError } from './trash-restore-errors';

// #4840: every refused restore read "Couldn't restore this record.". Each
// refusal the restore door answers takes the real lane here — the door's
// envelope, the adapter row, `runAdapted` — into the mapper.

const ADAPTER =
  settingsWriteAdapters['governance/restore:restoreSoftDeletedRow'];

/** The words a refusal maps to: a catalog key under `namespace`, and
 * whether the row has left the trash. */
interface Expected {
  namespace: 'governance' | 'contacts';
  key: string;
  rowGone: boolean;
}

const REFUSALS: Array<{ code: string; status: number; expected: Expected }> = [
  {
    // Another admin restored the row, or it was deleted for good.
    code: 'ROW_NOT_FOUND',
    status: 404,
    expected: {
      namespace: 'governance',
      key: 'trash.restore.gone',
      rowGone: true,
    },
  },
  {
    // The contact was deleted for good.
    code: 'CONTACT_NOT_FOUND',
    status: 404,
    expected: {
      namespace: 'governance',
      key: 'trash.restore.gone',
      rowGone: true,
    },
  },
  {
    code: 'CONTACT_DUPLICATE_EMAIL',
    status: 409,
    expected: {
      namespace: 'contacts',
      key: 'import.errorCodes.duplicate_email',
      rowGone: false,
    },
  },
  {
    code: 'CONTACT_DUPLICATE_EXTERNAL_ID',
    status: 409,
    expected: {
      namespace: 'contacts',
      key: 'import.errorCodes.duplicate_external_id',
      rowGone: false,
    },
  },
  {
    code: 'RESOURCE_TYPE_UNSUPPORTED',
    status: 400,
    expected: {
      namespace: 'governance',
      key: 'trash.restore.unsupported',
      rowGone: false,
    },
  },
  {
    code: 'FORBIDDEN',
    status: 403,
    expected: {
      namespace: 'governance',
      key: 'trash.restore.forbidden',
      rowGone: false,
    },
  },
  {
    // A code this map does not know reads as the page's own line.
    code: 'TRASH_SOMETHING_NEW',
    status: 409,
    expected: {
      namespace: 'governance',
      key: 'trash.restore.failedDescription',
      rowGone: false,
    },
  },
];

const LOCALES = ['en', 'de', 'fr'] as const;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

/** What the restore throws when its door answers `status` with `body`. */
async function thrownBy(
  status: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  vi.spyOn(window, 'fetch').mockResolvedValue(Response.json(body, { status }));
  if (ADAPTER === undefined) throw new Error('No restore adapter row');
  return runAdapted(() =>
    ADAPTER.run(
      { organizationId: 'org-a', resourceType: 'contact', rowId: 'row-a' },
      {},
    ),
  ).then(
    () => {
      throw new Error('the restore resolved');
    },
    (error: unknown) => error,
  );
}

describe('mapTrashRestoreError', () => {
  it.each(REFUSALS)(
    'words $code in the reader’s language',
    async ({ code, status, expected }) => {
      // The door answers a bare code.
      const error = await thrownBy(status, { error: code });

      for (const locale of LOCALES) {
        const t = i18n.getFixedT(locale, 'governance');
        const tContacts = i18n.getFixedT(locale, 'contacts');
        const words = (expected.namespace === 'contacts' ? tContacts : t)(
          expected.key,
        );
        // The catalog has the text: i18next answers a missing key with itself.
        expect(words, `${locale}: ${expected.key}`).not.toBe(expected.key);
        expect(mapTrashRestoreError(error, t, tContacts), locale).toEqual({
          description: words,
          rowGone: expected.rowGone,
        });
      }
      // The list re-reads exactly when the row has left the trash.
      expect(ADAPTER?.refusalInvalidates?.(error)).toBe(expected.rowGone);
    },
  );

  it('tells a person whose session lapsed to sign in again', async () => {
    const error = await thrownBy(401, {
      error: 'UNAUTHORIZED',
      message: 'Unauthorized: send an API key to the REST API',
    });

    expect(
      mapTrashRestoreError(
        error,
        i18n.getFixedT('en', 'governance'),
        i18n.getFixedT('en', 'contacts'),
      ),
    ).toEqual({
      description: 'Your session has ended. Sign in again.',
      rowGone: false,
    });
  });
});
