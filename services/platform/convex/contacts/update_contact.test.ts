import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import schema from '../schema';
import { updateContact } from './update_contact';

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

const ORG = 'org_contacts_update';

describe('updateContact (#2640 clearing an optional field)', () => {
  it('persists an explicit empty-string name instead of leaving the old value', async () => {
    const t = convexTest(schema, modules);

    const contactId = await t.run((ctx) =>
      ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'John',
        email: 'john@example.com',
        source: 'manual_import',
      }),
    );

    // Mirrors the client's onSubmit: send the trimmed value as-is (`''`),
    // never `undefined` — `undefined` args are dropped by `cleanUpdateData`
    // as "unchanged" (see update_contact.ts), so they can't clear a field.
    await t.run((ctx) =>
      updateContact(ctx, { contactId, name: '', email: 'john@example.com' }),
    );

    const row = await t.run((ctx) => ctx.db.get(contactId));
    expect(row?.name).toBe('');
  });

  it('leaves the name untouched when the arg is omitted (undefined)', async () => {
    const t = convexTest(schema, modules);

    const contactId = await t.run((ctx) =>
      ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'Jane',
        email: 'jane@example.com',
        source: 'manual_import',
      }),
    );

    await t.run((ctx) =>
      updateContact(ctx, { contactId, phone: '+1 555 0100' }),
    );

    const row = await t.run((ctx) => ctx.db.get(contactId));
    expect(row?.name).toBe('Jane');
    expect(row?.phone).toBe('+1 555 0100');
  });
});
