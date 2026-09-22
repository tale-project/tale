// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const { backendFetch } = vi.hoisted(() => ({
  backendFetch: vi.fn().mockResolvedValue({ skill: { slug: 'alpha' } }),
}));
vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  backendFetch,
}));

import { libraryWriteAdapters } from './library';

function lastBody(): Record<string, unknown> {
  const call = backendFetch.mock.calls.at(-1);
  if (call === undefined) throw new Error('backendFetch was not called');
  return (call[1] as { body: Record<string, unknown> }).body;
}

describe('skills/actions:saveSkill', () => {
  const run = libraryWriteAdapters['skills/actions:saveSkill']?.run;
  if (run === undefined) throw new Error('adapter missing');
  const ctx = { organizationId: 'org-1' } as never;

  it('forwards null so the door clears a stored icon', async () => {
    await run(
      {
        organizationId: 'org-1',
        slug: 'alpha',
        description: 'd',
        body: 'b',
        icon: null,
      },
      ctx,
    );
    expect(lastBody()).toMatchObject({ icon: null });
  });

  it('omits the field when the caller does not touch the icon', async () => {
    await run(
      { organizationId: 'org-1', slug: 'alpha', description: 'd', body: 'b' },
      ctx,
    );
    expect(lastBody()).not.toHaveProperty('icon');
  });
});
