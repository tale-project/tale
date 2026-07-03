import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// convex-test module map, keyed relative to the convex/ root. This file lives at
// convex/vendors/, so the glob reaches the root via ../ and keys are normalized
// back to convex-root-relative paths.
const TEST_DIR_FROM_CONVEX_ROOT = 'vendors';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_vendor_dupguard';

// Read the `{ code }` off a thrown ConvexError. convex-test surfaces the error
// `data` as the serialized JSON string (the real Convex client deserializes it
// to an object), so accept either form. Duck-typed because convex-test can also
// bundle a second ConvexError class copy, making `instanceof` unreliable.
function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = (err as { data: unknown }).data;
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  if (typeof data !== 'object' || data === null || !('code' in data)) {
    return undefined;
  }
  const candidate: unknown = (data as { code: unknown }).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

describe('createVendor duplicate guard (#1993)', () => {
  // Regression: the duplicate-add rejection must carry a structured
  // ConvexError code. A raw `Error` is redacted to "Server Error" in prod, so
  // the client logs an uncaught Convex Server Error and downstream code is
  // forced to string-match the message.
  it('throws ConvexError({ code: VENDOR_DUPLICATE_EMAIL }) on an email collision', async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('vendors', {
        organizationId: ORG,
        email: 'dup@example.com',
        source: 'manual_import',
      });
    });

    let code: string | undefined;
    try {
      await t.mutation(internal.vendors.internal_mutations.createVendor, {
        organizationId: ORG,
        // Mixed case + whitespace normalizes to the existing lowercased email.
        email: '  Dup@Example.com ',
        source: 'manual_import',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('VENDOR_DUPLICATE_EMAIL');
  });

  it('throws ConvexError({ code: VENDOR_DUPLICATE_EXTERNAL_ID }) on an externalId collision', async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('vendors', {
        organizationId: ORG,
        externalId: 'ext-42',
        source: 'manual_import',
      });
    });

    let code: string | undefined;
    try {
      await t.mutation(internal.vendors.internal_mutations.createVendor, {
        organizationId: ORG,
        externalId: 'ext-42',
        source: 'manual_import',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('VENDOR_DUPLICATE_EXTERNAL_ID');
  });

  it('inserts the vendor when no collision exists', async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(
      internal.vendors.internal_mutations.createVendor,
      {
        organizationId: ORG,
        email: 'fresh@example.com',
        externalId: 'ext-fresh',
        source: 'manual_import',
      },
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.email).toBe('fresh@example.com');
  });
});
