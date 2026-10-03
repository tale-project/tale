// @vitest-environment node

/**
 * The product writes validate what the column constraints used to catch
 * last. The regressions under test: a `status` outside the vocabulary
 * reached Postgres and its CHECK constraint surfaced as a 500; a second
 * product with the same connector `externalId` was admitted (the reference
 * promises 409); and the update dropped `externalId` on the floor.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { blobRefHeld, createAuditLog, emitHintInTx, loadActiveHolds } =
  vi.hoisted(() => ({
    blobRefHeld: vi.fn(),
    createAuditLog: vi.fn(async (..._args: unknown[]) => 'audit-1'),
    emitHintInTx: vi.fn(async () => undefined),
    loadActiveHolds: vi.fn(async () => ({
      orgHeld: false,
      userMembershipIds: new Set<string>(),
    })),
  }));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../legal_holds/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../legal_holds/service.ts')>()),
  loadActiveHolds,
}));
// The real rule, watched: the release must ask it rather than a copy.
vi.mock('../files/blob-holders.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../files/blob-holders.ts')>();
  blobRefHeld.mockImplementation(actual.blobRefHeld);
  return { blobRefHeld };
});

import { productImageUrl } from './image-url.ts';
import {
  createProduct,
  deleteProduct,
  PRODUCT_STATUSES,
  ProductError,
  updateProduct,
} from './service.ts';

type Statement = { text: string; values: unknown[] };

function recordingSql(
  answer: (text: string, values: unknown[]) => unknown[] = () => [],
) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const scope = { organizationId: 'org-1', userId: 'user-1', role: 'admin' };
const product = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Widget',
  description: null,
  imageUrl: null,
  stock: null,
  price: null,
  currency: null,
  category: null,
  tags: [],
  status: 'active',
  translations: null,
  externalId: 'sku-1',
  metadata: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadActiveHolds.mockResolvedValue({
    orgHeld: false,
    userMembershipIds: new Set<string>(),
  });
});

describe('product status vocabulary', () => {
  it('refuses a status outside the vocabulary before any statement runs', async () => {
    const { sql, statements } = recordingSql();
    let caught: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction; the vocabulary check is the point
      await createProduct(sql as never, scope, {
        name: 'Widget',
        status: 'bogus',
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProductError);
    expect(caught).toMatchObject({
      code: 'PRODUCT_STATUS_INVALID',
      status: 400,
    });
    expect((caught as Error).message).toContain(PRODUCT_STATUSES.join(', '));
    expect(statements).toHaveLength(0);
  });

  it('refuses it on update too, with nothing written', async () => {
    const { sql, statements } = recordingSql(() => [product]);
    await expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
      updateProduct(sql as never, scope, 'p-1', { status: 'ACTIVE' } as never),
    ).rejects.toMatchObject({ code: 'PRODUCT_STATUS_INVALID' });
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
  });
});

describe('product external id uniqueness', () => {
  it('refuses a second product carrying the same external id with 409', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('external_id = ?') ? [{ id: 'p-other' }] : [],
    );
    let caught: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      await createProduct(sql as never, scope, {
        name: 'Gadget',
        externalId: 'sku-1',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'DUPLICATE_PRODUCT_EXTERNAL_ID',
      status: 409,
    });
    expect(statements.some((s) => s.text.startsWith('INSERT'))).toBe(false);
  });

  it('writes a changed external id on update after checking it is free', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.products WHERE id = ?') ? [product] : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await updateProduct(sql as never, scope, 'p-1', { externalId: 'sku-2' });
    const probe = statements.find(
      (s) => s.text.includes('external_id = ?') && s.text.startsWith('SELECT'),
    );
    expect(probe?.values).toEqual(expect.arrayContaining(['sku-2', 'p-1']));
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.products'),
    );
    expect(update?.text).toContain('external_id = ?');
    expect(update?.values).toContain('sku-2');
  });
});

/**
 * The product update's editing vocabulary. The regressions under test:
 * `metadata` was replaced whole (adding one key wiped every other); `null`
 * was refused so no spelling cleared a field, and a `null` status tripped
 * the vocabulary check; `tags: null` kept the stored list.
 */
describe('product update — merge and the clearing rule', () => {
  /** The UPDATE's bound values, by column order of the statement. */
  const UPDATE = {
    description: 1,
    imageUrl: 2,
    currency: 5,
    category: 6,
    tags: 7,
    status: 8,
    externalId: 9,
    metadata: 10,
  } as const;
  const stored = {
    ...product,
    description: 'A widget',
    currency: 'EUR',
    tags: ['a'],
    metadata: { a: 1, keep: true, nested: { x: 1 } },
  };

  async function update(patch: Parameters<typeof updateProduct>[3]) {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.products WHERE id = ?') ? [stored] : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await updateProduct(sql as never, scope, 'p-1', patch);
    const written = statements.find((s) =>
      s.text.startsWith('UPDATE app.products'),
    );
    if (written === undefined) throw new Error('no UPDATE ran');
    return written.values;
  }

  it('merges metadata per RFC 7396 and keeps every other column', async () => {
    const values = await update({
      metadata: { b: 2, a: null, nested: { y: 2 } },
    });
    expect(values[UPDATE.metadata]).toEqual({
      keep: true,
      nested: { x: 1, y: 2 },
      b: 2,
    });
    expect(values[UPDATE.description]).toBe('A widget');
    expect(values[UPDATE.tags]).toEqual(['a']);
  });

  it('clears every optional field sent as null, status included', async () => {
    const values = await update({
      description: null,
      imageUrl: null,
      currency: null,
      category: null,
      tags: null,
      status: null,
      externalId: null,
      metadata: null,
    });
    expect(values[UPDATE.description]).toBeNull();
    expect(values[UPDATE.imageUrl]).toBeNull();
    expect(values[UPDATE.currency]).toBeNull();
    expect(values[UPDATE.category]).toBeNull();
    expect(values[UPDATE.tags]).toEqual([]);
    expect(values[UPDATE.status]).toBeNull();
    expect(values[UPDATE.externalId]).toBeNull();
    expect(values[UPDATE.metadata]).toBeNull();
  });

  it('reads a blank as null and trims free text', async () => {
    const values = await update({ description: '   ', category: ' Tools ' });
    expect(values[UPDATE.description]).toBeNull();
    expect(values[UPDATE.category]).toBe('Tools');
  });

  it('creates with cleared optional fields without probing the external id', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('INSERT INTO app.products') ? [{ id: 'p-new' }] : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    const id = await createProduct(sql as never, scope, {
      name: 'Gadget',
      externalId: null,
      metadata: null,
      description: '  ',
    });
    expect(id).toBe('p-new');
    expect(statements.some((s) => s.text.includes('product-ext:'))).toBe(false);
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.products'),
    );
    expect(insert?.values).toEqual(
      expect.arrayContaining(['org-1', 'Gadget', null]),
    );
  });
});

describe('product update — a patch that changes nothing', () => {
  const stored = {
    ...product,
    description: 'A widget',
    currency: 'EUR',
    tags: ['a'],
    metadata: { a: 1, keep: true },
  };
  function sqlWithRow() {
    return recordingSql((text) =>
      text.includes('FROM app.products WHERE id = ?') ? [stored] : [],
    );
  }

  // A no-op used to move `updatedAt`, write an audit row and raise a hint
  // (2026-09-14 evaluation, g7-7c).
  it('writes nothing, audits nothing and raises no hint when every field is already at its value', async () => {
    const { sql, statements } = sqlWithRow();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await updateProduct(sql as never, scope, 'p-1', {
      description: 'A widget',
      currency: 'EUR',
      tags: ['a'],
      metadata: { a: 1 },
      externalId: 'sku-1',
      expectedUpdatedAt: 1,
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.products')),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('still refuses a stale expectedUpdatedAt ahead of the short-circuit', async () => {
    const { sql, statements } = sqlWithRow();
    await expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      updateProduct(sql as never, scope, 'p-1', {
        description: 'A widget',
        expectedUpdatedAt: 0,
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_STALE' });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.products')),
    ).toBe(false);
  });

  it('writes once a single field differs', async () => {
    const { sql, statements } = sqlWithRow();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await updateProduct(sql as never, scope, 'p-1', { description: 'Changed' });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.products')),
    ).toBe(true);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });
});

/**
 * A deleted product's uploaded image used to stay: its `file_metadata` row
 * kept answering the uploader's preview and the blob was never reclaimed.
 * The row now goes inside the write, the blob ref comes back for the
 * post-commit reclaim, and a hold or a second product keeps the bytes.
 */
describe('product delete and image release', () => {
  const imageId = '05b12345-1020-4000-8000-123456789abc';
  const imageUrl = productImageUrl('org-1', imageId);
  const withImage = { ...product, imageUrl };
  const imageRow = { storageRef: 's3:org-1/img', uploadedBy: 'user-2' };

  function harness(options: {
    stillShown?: boolean;
    imageRow?: typeof imageRow | null;
    referenced?: boolean;
  }) {
    return recordingSql((text) => {
      if (text.includes('FROM app.products WHERE id = ?')) return [withImage];
      if (text.includes('AND image_url = ?'))
        return options.stillShown ? [{ id: 'p-2' }] : [];
      if (text.includes('FROM app.file_metadata WHERE id = ?'))
        return options.imageRow === null ? [] : [options.imageRow ?? imageRow];
      if (text.includes('AS referenced'))
        return [{ referenced: options.referenced ?? false }];
      return [];
    });
  }

  it('deletes the image row inside the write and answers its blob for the reclaim', async () => {
    const { sql, statements } = harness({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    const released = await deleteProduct(sql as never, scope, 'p-1');
    expect(released).toEqual(['s3:org-1/img']);
    const texts = statements.map((s) => s.text);
    expect(texts.some((t) => t.startsWith('DELETE FROM app.products'))).toBe(
      true,
    );
    expect(
      texts.some((t) => t.startsWith('DELETE FROM app.file_metadata')),
    ).toBe(true);
    // Never the blob from inside the transaction: the caller reclaims it
    // once the delete is committed.
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'product.deleted' }),
    );
  });

  it('keeps the upload when another product still shows it', async () => {
    const { sql, statements } = harness({ stillShown: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    expect(await deleteProduct(sql as never, scope, 'p-1')).toEqual([]);
    expect(
      statements.some((s) =>
        s.text.startsWith('DELETE FROM app.file_metadata'),
      ),
    ).toBe(false);
  });

  it('keeps the blob when another row still serves the same bytes', async () => {
    const { sql } = harness({ referenced: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    expect(await deleteProduct(sql as never, scope, 'p-1')).toEqual([]);
  });

  it('asks the files domain holder rule, so a task or a retained version keeps the bytes (#4110)', async () => {
    const { sql, statements } = harness({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await deleteProduct(sql as never, scope, 'p-1');
    // Its own copy knew file rows and a document's current file only, and
    // deleted the bytes of an image a task listed as an attachment.
    expect(blobRefHeld).toHaveBeenCalledTimes(1);
    expect(blobRefHeld).toHaveBeenCalledWith(sql, 'org-1', expect.anything());
    expect(statements).toContainEqual({ text: '?', values: ['s3:org-1/img'] });
    const texts = statements.map((s) => s.text);
    expect(texts.some((t) => t.includes('history_files @> ARRAY['))).toBe(true);
    expect(texts.some((t) => t.includes('FROM app.tasks held'))).toBe(true);
  });

  it('releases nothing for an external image URL', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.products WHERE id = ?')
        ? [{ ...product, imageUrl: 'https://images.example/p.png' }]
        : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    expect(await deleteProduct(sql as never, scope, 'p-1')).toEqual([]);
    expect(statements.some((s) => s.text.includes('app.file_metadata'))).toBe(
      false,
    );
  });

  it('refuses the delete under an organization-wide legal hold, nothing written', async () => {
    loadActiveHolds.mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set<string>(),
    });
    const { sql, statements } = harness({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await expect(
      deleteProduct(sql as never, scope, 'p-1'),
    ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE', status: 409 });
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
  });

  it('refuses the delete while the image uploader is on a custodian hold', async () => {
    loadActiveHolds.mockResolvedValue({
      orgHeld: false,
      userMembershipIds: new Set(['user-2']),
    });
    const { sql, statements } = harness({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await expect(
      deleteProduct(sql as never, scope, 'p-1'),
    ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ACTIVE' });
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
  });

  it('releases the superseded image on a replace or a remove, and keeps it under a hold', async () => {
    const run = async (patch: { imageUrl: string | null }) => {
      const { sql, statements } = harness({});
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      const released = await updateProduct(sql as never, scope, 'p-1', patch);
      return { released, statements };
    };
    const removed = await run({ imageUrl: null });
    expect(removed.released).toEqual(['s3:org-1/img']);
    expect(
      removed.statements.some((s) =>
        s.text.startsWith('DELETE FROM app.file_metadata'),
      ),
    ).toBe(true);
    const replaced = await run({ imageUrl: 'https://images.example/new.png' });
    expect(replaced.released).toEqual(['s3:org-1/img']);
    // A patch that keeps the image releases nothing.
    const kept = await run({ imageUrl });
    expect(kept.released).toEqual([]);

    loadActiveHolds.mockResolvedValue({
      orgHeld: true,
      userMembershipIds: new Set<string>(),
    });
    const held = await run({ imageUrl: null });
    expect(held.released).toEqual([]);
    expect(
      held.statements.some((s) => s.text.startsWith('UPDATE app.products')),
    ).toBe(true);
    expect(
      held.statements.some((s) =>
        s.text.startsWith('DELETE FROM app.file_metadata'),
      ),
    ).toBe(false);
  });
});
