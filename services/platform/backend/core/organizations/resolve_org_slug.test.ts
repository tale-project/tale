import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/handler_names', () => ({
  components: { betterAuth: { adapter: { findOne: 'findOne' } } },
}));

const { resolveOrgSlug } = await import('./resolve_org_slug');

function makeCtx(findOneResult: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(findOneResult),
  };
}

// Production-shaped document id so orgSlugFromId's syntactic gate lets the
// mocked runQuery answer through (short fixtures like 'org_abc' are rejected).
const ORG_ID = 'jn7e5agwkrztazsh38bq0zt73n87e20w';
const MISSING_ORG_ID = 'kd72m0v4d3sa8gh2plq9x1c5znb0e4tf';

describe('resolveOrgSlug', () => {
  it('returns the slug for an existing organization', async () => {
    const ctx = makeCtx({ _id: ORG_ID, slug: 'acme' });
    await expect(resolveOrgSlug(ctx as never, ORG_ID)).resolves.toBe('acme');
  });

  it('throws when the organization is not found', async () => {
    const ctx = makeCtx(null);
    await expect(resolveOrgSlug(ctx as never, MISSING_ORG_ID)).rejects.toThrow(
      /no organization row found for id .*kd72m0v4d3sa8gh2plq9x1c5znb0e4tf/,
    );
  });

  it('throws when the organization row is missing a slug field', async () => {
    const ctx = makeCtx({ _id: ORG_ID });
    await expect(resolveOrgSlug(ctx as never, ORG_ID)).rejects.toThrow(
      /organization .*jn7e5agwkrztazsh38bq0zt73n87e20w.* has no slug/,
    );
  });
});
