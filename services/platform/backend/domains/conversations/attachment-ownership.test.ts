// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';

import { firstForeignUpload } from '../files/upload-intents.ts';
import { assertOwnedAttachments } from './attachment-ownership.ts';
import { ConversationError } from './service.ts';

/**
 * The outbound-mail ownership rule: every attachment must be the sender's
 * own upload. The send's transaction asks it with the stamp (the default),
 * so a refusal rolls the stamp back; the route asks first without one
 * (#4111).
 */

vi.mock(import('../files/upload-intents.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  firstForeignUpload: vi.fn(),
}));

const sql = {} as Sql;
const scope = { organizationId: 'o1', userId: 'u1' };
const FILES = [{ storageId: 'blob-1' }, { storageId: 'blob-2' }];

afterEach(() => {
  vi.clearAllMocks();
});

it('proves every attachment through the stamping proof by default', async () => {
  vi.mocked(firstForeignUpload).mockResolvedValue(null);

  await assertOwnedAttachments(sql, scope, FILES);

  expect(firstForeignUpload).toHaveBeenCalledWith(
    sql,
    scope,
    ['blob-1', 'blob-2'],
    {},
  );
});

it('passes stamp: false through for the early refusal', async () => {
  vi.mocked(firstForeignUpload).mockResolvedValue(null);

  await assertOwnedAttachments(sql, scope, FILES, { stamp: false });

  expect(firstForeignUpload).toHaveBeenCalledWith(
    sql,
    scope,
    ['blob-1', 'blob-2'],
    { stamp: false },
  );
});

it('refuses a foreign attachment with ATTACHMENT_NOT_OWNED [CONV-R11]', async () => {
  vi.mocked(firstForeignUpload).mockResolvedValue('blob-2');

  const refusal = await assertOwnedAttachments(sql, scope, FILES).catch(
    (error: unknown) => error,
  );

  expect(refusal).toBeInstanceOf(ConversationError);
  expect(refusal).toMatchObject({ code: 'ATTACHMENT_NOT_OWNED', status: 403 });
});

it('asks nothing for a send without attachments', async () => {
  await assertOwnedAttachments(sql, scope, undefined);
  await assertOwnedAttachments(sql, scope, []);

  expect(firstForeignUpload).not.toHaveBeenCalled();
});
