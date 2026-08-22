import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../schema';
import { createContact } from './create_contact';

// convex-test module map, keyed relative to the convex/ root. This file lives at
// convex/contacts/, so the glob reaches the root via ../ and keys are normalized
// back to convex-root-relative paths.
const TEST_DIR_FROM_CONVEX_ROOT = 'contacts';
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

const ORG = 'org_contacts_create';

// Read the `{ code }` off a thrown ConvexError. convex-test surfaces the error
// `data` as the serialized JSON string (the real Convex client deserializes it
// to an object), so accept either form.
function codeOf(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  let data: unknown = err.data;
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

describe('createContact (#2639 structured create form)', () => {
  it('inserts a contact with the fields the create form submits', async () => {
    const t = convexTest(schema, modules);

    const result = await t.run((ctx) =>
      createContact(ctx, {
        organizationId: ORG,
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1 555 0100',
        locale: 'en',
        source: 'manual_import',
      }),
    );

    expect(result.success).toBe(true);
    const row = await t.run((ctx) => ctx.db.get(result.contactId));
    expect(row).toMatchObject({
      organizationId: ORG,
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+1 555 0100',
      locale: 'en',
      source: 'manual_import',
    });
  });

  it('leaves locale unset when omitted, instead of fabricating "en" (#2642)', async () => {
    const t = convexTest(schema, modules);

    const result = await t.run((ctx) =>
      createContact(ctx, {
        organizationId: ORG,
        email: 'no-locale@example.com',
        source: 'manual_import',
      }),
    );

    const row = await t.run((ctx) => ctx.db.get(result.contactId));
    expect(row?.locale).toBeUndefined();
  });

  it('throws ConvexError({ code: CONTACT_DUPLICATE_EMAIL }) on a repeat email', async () => {
    const t = convexTest(schema, modules);

    await t.run((ctx) =>
      ctx.db.insert('contacts', {
        organizationId: ORG,
        email: 'dupe@example.com',
        source: 'manual_import',
      }),
    );

    let code: string | undefined;
    try {
      await t.run((ctx) =>
        createContact(ctx, {
          organizationId: ORG,
          email: 'Dupe@Example.com', // case-insensitive match
          source: 'manual_import',
        }),
      );
    } catch (err) {
      code = codeOf(err);
    }

    expect(code).toBe('CONTACT_DUPLICATE_EMAIL');
  });
});
