import { beforeEach, describe, expect, it, vi } from 'vitest';

const { putOrgBlobBytes, registerUploadedBytes, deleteOrgBlobRefs } =
  vi.hoisted(() => ({
    putOrgBlobBytes: vi.fn(),
    registerUploadedBytes: vi.fn(),
    deleteOrgBlobRefs: vi.fn(),
  }));
vi.mock('../files/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/service.ts')>()),
  putOrgBlobBytes,
  registerUploadedBytes,
  deleteOrgBlobRefs,
}));

import {
  isProductImageUrl,
  productImageId,
  productImageUrl,
  readProductImage,
  uploadProductImage,
  validateProductImageBinding,
} from './images.ts';

const scope = { organizationId: 'org-1', userId: 'u1', role: 'admin' };
const id = '05b12345-1020-4000-8000-123456789abc';
const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ls0AAAAASUVORK5CYII=',
    'base64',
  ),
);
function db(...answers: unknown[]) {
  const sql = Object.assign(
    vi.fn(
      async (_strings: TemplateStringsArray, ..._values: unknown[]) =>
        answers.shift() ?? [],
    ),
    { unsafe: vi.fn((s: string) => s) },
  );
  return sql;
}
const row = {
  id,
  uploadedBy: 'u1',
  contentType: 'image/png',
  storageRef: 's3:org-1/image',
};

describe('private product image registration and access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BASE_PATH', '');
    putOrgBlobBytes.mockResolvedValue(row.storageRef);
    registerUploadedBytes.mockResolvedValue({ fileId: id });
    deleteOrgBlobRefs.mockResolvedValue(undefined);
  });

  it('registers detected image bytes and returns a stable org-scoped app URL', async () => {
    const sql = db();
    expect(await uploadProductImage(sql as never, scope, png)).toEqual({
      imageUrl: productImageUrl(scope.organizationId, id),
    });
    expect(registerUploadedBytes).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        source: 'product-image',
        uploadedBy: scope.userId,
        contentType: 'image/png',
        size: png.length,
        skipRagIndexing: true,
      }),
    );
  });

  it('reclaims only the newly stored blob if registration fails', async () => {
    registerUploadedBytes.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(uploadProductImage(db() as never, scope, png)).rejects.toThrow(
      'database unavailable',
    );
    expect(deleteOrgBlobRefs).toHaveBeenCalledWith(
      expect.anything(),
      scope.organizationId,
      [row.storageRef],
    );
  });

  it.each([
    new Uint8Array(),
    new Uint8Array(5 * 1024 * 1024 + 1),
    new TextEncoder().encode('<html>not an image</html>'),
    new TextEncoder().encode('<svg><script>alert(1)</script></svg>'),
  ])(
    'refuses invalid or active image bytes before object storage',
    async (bytes) => {
      await expect(
        uploadProductImage(db() as never, scope, bytes),
      ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_INVALID' });
      expect(putOrgBlobBytes).not.toHaveBeenCalled();
    },
  );

  it('allows passive SVG and records the server-detected type', async () => {
    await uploadProductImage(
      db() as never,
      scope,
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      ),
    );
    expect(registerUploadedBytes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentType: 'image/svg+xml' }),
    );
  });

  it('refuses a member without product write permission before storage', async () => {
    await expect(
      uploadProductImage(db() as never, { ...scope, role: 'member' }, png),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(putOrgBlobBytes).not.toHaveBeenCalled();
  });

  it('permits uploader preview without any product binding', async () => {
    const sql = db([row]);
    expect(await readProductImage(sql as never, scope, id)).toEqual(row);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('requires a current same-org product binding for a different member', async () => {
    const other = { ...scope, userId: 'u2', role: 'member' };
    await expect(
      readProductImage(db([row], []) as never, other, id),
    ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_NOT_FOUND' });
    expect(
      await readProductImage(
        db([row], [{ id: 'product-1' }]) as never,
        other,
        id,
      ),
    ).toEqual(row);
  });

  it('refuses missing or non-image metadata without consulting product bindings', async () => {
    for (const rows of [[], [{ ...row, contentType: 'text/html' }]]) {
      const sql = db(rows);
      await expect(
        readProductImage(sql as never, scope, id),
      ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_NOT_FOUND' });
      expect(sql).toHaveBeenCalledTimes(1);
    }
  });

  it('locks the registered file while validating an app write', async () => {
    const sql = db([row]);
    await validateProductImageBinding(
      sql as never,
      scope,
      productImageUrl(scope.organizationId, id),
    );
    expect(sql.unsafe).toHaveBeenCalledWith('FOR UPDATE');
    const query = sql.mock.calls[0]?.[0];
    expect(String(query)).toContain('document_id IS NULL');
  });

  it('rejects forged org, suffix, host, and query forms of an internal binding', async () => {
    const url = productImageUrl(scope.organizationId, id);
    for (const value of [
      url + '&other=1',
      url + '#fragment',
      url.replace('org-1', 'org-2'),
      url.replace(id, 's3:private-ref'),
      '//evil.test' + url,
    ]) {
      expect(productImageId(value, scope.organizationId)).toBeNull();
      await expect(
        validateProductImageBinding(db() as never, scope, value),
      ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_NOT_FOUND' });
    }
    expect(isProductImageUrl('https://public.example/image.png')).toBe(false);
  });

  it('builds and accepts exactly the configured deployment base path', () => {
    vi.stubEnv('BASE_PATH', '/workspace/');
    const url = productImageUrl(scope.organizationId, id);
    expect(url).toBe(`/workspace/api/app/products/images/${id}?orgId=org-1`);
    expect(productImageId(url, scope.organizationId)).toBe(id);
    expect(
      productImageId(url.replace('/workspace', ''), scope.organizationId),
    ).toBeNull();
  });
});
