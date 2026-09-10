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

const { createAuditLog, emitHintInTx } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (..._args: unknown[]) => 'audit-1'),
  emitHintInTx: vi.fn(async () => undefined),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));

import {
  createProduct,
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
