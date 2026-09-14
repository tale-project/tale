import { expect, it, vi } from 'vitest';

import { deleteFile } from './service.ts';

it('keeps an uploaded image while a product still binds it', async () => {
  const file = {
    id: 'f1',
    organizationId: 'o1',
    documentId: null,
    storageRef: 's3:org/image',
  };
  const tx = Object.assign(
    vi
      .fn()
      .mockResolvedValueOnce([file])
      .mockResolvedValueOnce([{ id: 'product-1' }]),
    { unsafe: vi.fn((text: string) => text) },
  );
  await expect(
    deleteFile({} as never, tx as never, { organizationId: 'o1' }, 'f1'),
  ).rejects.toMatchObject({ code: 'FILE_BOUND_TO_PRODUCT', status: 409 });
  expect(
    tx.mock.calls.some((call) =>
      String(call[0]).includes('DELETE FROM app.file_metadata'),
    ),
  ).toBe(false);
});
