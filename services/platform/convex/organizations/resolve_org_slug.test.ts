import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/api', () => ({
  components: { betterAuth: { adapter: { findOne: 'findOne' } } },
}));

const { resolveOrgSlug } = await import('./resolve_org_slug');

function makeCtx(findOneResult: unknown) {
  return {
    runQuery: vi.fn().mockResolvedValue(findOneResult),
  };
}

describe('resolveOrgSlug', () => {
  it('returns the slug for an existing organization', async () => {
    const ctx = makeCtx({ _id: 'org_abc', slug: 'acme' });
    await expect(resolveOrgSlug(ctx as never, 'org_abc')).resolves.toBe('acme');
  });

  it('throws when the organization is not found', async () => {
    const ctx = makeCtx(null);
    await expect(resolveOrgSlug(ctx as never, 'org_missing')).rejects.toThrow(
      /Organization org_missing not found or missing slug/,
    );
  });

  it('throws when the organization row is missing a slug field', async () => {
    const ctx = makeCtx({ _id: 'org_abc' });
    await expect(resolveOrgSlug(ctx as never, 'org_abc')).rejects.toThrow(
      /Organization org_abc not found or missing slug/,
    );
  });
});
