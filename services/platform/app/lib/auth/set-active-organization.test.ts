import { beforeEach, describe, expect, it, vi } from 'vitest';

import { failureDetail } from '@/app/lib/backend/adapters';

const h = vi.hoisted(() => ({ setActive: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({
  authClient: { organization: { setActive: h.setActive } },
}));

import { setActiveOrganization } from './set-active-organization';

beforeEach(() => {
  h.setActive.mockReset();
});

describe('setActiveOrganization', () => {
  it('resolves once the session switched', async () => {
    h.setActive.mockResolvedValue({ data: { id: 'org-globex' }, error: null });
    await expect(setActiveOrganization('org-globex')).resolves.toBeUndefined();
    expect(h.setActive).toHaveBeenCalledWith({ organizationId: 'org-globex' });
  });

  // Better Auth answers a refusal instead of throwing it; every caller went
  // on as if the session had switched.
  it('throws a refusal the client answers, in its own words', async () => {
    h.setActive.mockResolvedValue({
      data: null,
      error: {
        status: 429,
        statusText: 'Too Many Requests',
        message: 'Too many requests. Please try again later.',
      },
    });
    const thrown: unknown = await setActiveOrganization('org-globex').catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(failureDetail(thrown)).toBe(
      'Too many requests. Please try again later.',
    );
  });

  it('passes on a request that gets no answer', async () => {
    const lost = new TypeError('Failed to fetch');
    h.setActive.mockRejectedValue(lost);
    await expect(setActiveOrganization('org-globex')).rejects.toBe(lost);
  });
});
