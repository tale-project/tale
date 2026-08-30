import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { createWebsite } from './create_website';

// convex-test module map, keyed relative to the convex/ root. This file lives at
// convex/websites/, so the glob reaches the root via ../ and keys are normalized
// back to convex-root-relative paths.
const TEST_DIR_FROM_CONVEX_ROOT = 'websites';
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

const ORG = 'org_dupguard';

// Read the `{ code }` off a thrown AppError. convex-test surfaces the error
// `data` as the serialized JSON string (the real Convex client deserializes it
// to an object), so accept either form. Duck-typed because convex-test can also
// bundle a second AppError class copy, making `instanceof` unreliable.
function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = err.data;
  // convex-test can double-encode the payload (a JSON string of a JSON string),
  // so unwrap repeatedly until we reach the object (bounded to avoid a loop).
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
  const candidate: unknown = data.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

describe('URL-list provisioning', () => {
  it('stores kind on list rows and leaves site rows without one', async () => {
    const t = convexTest(schema, modules);
    const listId = await t.mutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: ORG,
        domain: 'fedlex.admin.ch',
        kind: 'list',
        scanInterval: '6h',
        status: 'scanning',
      },
    );
    const siteId = await t.mutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: ORG,
        domain: 'example.org',
        scanInterval: '6h',
        status: 'scanning',
      },
    );
    await t.run(async (ctx) => {
      expect((await ctx.db.get(listId))?.kind).toBe('list');
      expect((await ctx.db.get(siteId))?.kind).toBeUndefined();
    });
  });
});

describe('createWebsite duplicate guard (#2056)', () => {
  // Regression: the duplicate-domain rejection must carry a structured
  // AppError code. A raw `Error` is redacted to "Server Error" in prod, so
  // the client cannot tell a duplicate apart from a generic failure.
  it('throws AppError({ code: WEBSITE_DUPLICATE_DOMAIN }) on a normalized-domain collision', async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('websites', {
        organizationId: ORG,
        domain: 'example.com',
        scanInterval: '6h',
        status: 'idle',
      });
    });

    // A full URL for the same host normalizes to the existing `example.com`.
    let code: string | undefined;
    try {
      await t.run((ctx) =>
        createWebsite(ctx, {
          organizationId: ORG,
          domain: 'https://example.com/pricing',
          scanInterval: '1d',
        }),
      );
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('WEBSITE_DUPLICATE_DOMAIN');
  });

  it('inserts the website when no domain collision exists', async () => {
    const t = convexTest(schema, modules);

    const id = await t.run((ctx) =>
      createWebsite(ctx, {
        organizationId: ORG,
        domain: 'https://fresh.example.org',
        scanInterval: '6h',
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.domain).toBe('fresh.example.org');
  });
});

describe('provisionWebsite scanInterval guard (#2090)', () => {
  // Regression: an out-of-enum scanInterval must be rejected at the write
  // chokepoint. Otherwise it is stored verbatim and silently crawled at the 6h
  // default (scanIntervalToSeconds falls back to 21600 for unknown values).
  it('rejects an out-of-enum scanInterval with INVALID_SCAN_INTERVAL', async () => {
    const t = convexTest(schema, modules);

    let code: string | undefined;
    try {
      await t.mutation(internal.websites.internal_mutations.provisionWebsite, {
        organizationId: ORG,
        domain: 'https://guarded.example.com',
        scanInterval: '3h',
      });
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('INVALID_SCAN_INTERVAL');
  });

  it('stores a website when the scanInterval is in the allowed enum', async () => {
    const t = convexTest(schema, modules);

    const id = await t.mutation(
      internal.websites.internal_mutations.provisionWebsite,
      {
        organizationId: ORG,
        domain: 'https://valid.example.com',
        scanInterval: '12h',
      },
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.scanInterval).toBe('12h');
  });
});
