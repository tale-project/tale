import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import schema from '../schema';

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

type T = TestConvex<typeof schema>;

const ORG = 'org_palette_contacts';
const USER = 'user_palette_contacts';

async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${USER}_${ORG}`,
      userId: USER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

describe('searchContacts', () => {
  it('returns contacts matching name or email', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const contactId = await t.run((ctx) =>
      ctx.db.insert('contacts', {
        organizationId: ORG,
        name: 'Jane Acme',
        email: 'jane@acme.example',
        source: 'manual_import',
      }),
    );

    const alice = t.withIdentity({ subject: USER });
    const hits = await alice.query(api.contacts.search.searchContacts, {
      organizationId: ORG,
      query: 'jane',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.contactId).toBe(contactId);
    expect(hits[0]?.snippet).toContain('jane@acme.example');
  });
});
