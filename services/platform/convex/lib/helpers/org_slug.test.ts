import { describe, expect, it, vi } from 'vitest';

import { orgSlugFromIdOrNull, orgSlugFromId } from './org_slug';

/**
 * The lookup must answer "no such org" for values that cannot BE document ids
 * WITHOUT crossing into the betterAuth component: the component's `db.get`
 * throws on them, which (a) logs an uncaught component-query error on every
 * caller cadence — observed as 5-minutely GlitchTip spam from a cron
 * reconciler resolving a `'system'`-style sentinel — and (b) looks transient
 * to `orgSlugFromIdOrNull`, so the caller retries forever instead of folding
 * to `null` once.
 */
describe('org slug lookup with non-id values', () => {
  it('folds a sentinel to null without a component round-trip', async () => {
    const runQuery = vi.fn();
    const result = await orgSlugFromIdOrNull({ runQuery }, 'system');
    expect(result).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('throws the terminal OrgSlugUnresolvableError from the strict variant', async () => {
    const runQuery = vi.fn();
    await expect(orgSlugFromId({ runQuery }, 'not-an-id')).rejects.toThrow(
      /no organization row found/,
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('still resolves a real-shaped id through the component', async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValue({ slug: 'test', name: 'larry-test' });
    const result = await orgSlugFromIdOrNull(
      { runQuery },
      'jn7e5agwkrztazsh38bq0zt73n87e20w',
    );
    expect(result).toBe('test');
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});
