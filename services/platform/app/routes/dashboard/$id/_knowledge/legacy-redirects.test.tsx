import { describe, expect, it, vi } from 'vitest';

// Regression coverage for #2634: `/customers` and `/vendors` were dead 404s
// after the customers+vendors→contacts merge (#2618) — no redirect was left
// for old bookmarks/links. Each route's loader must throw a `redirect()` to
// `/dashboard/$id/contacts`, carrying the org id through.

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((opts: unknown) => opts),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  redirect: mockRedirect,
}));

describe('legacy /customers and /vendors redirects (#2634)', () => {
  it('redirects /customers to /contacts for the current org', async () => {
    const { Route } = await import('./customers');
    const loader = (
      Route as unknown as {
        loader: (args: { params: { id: string } }) => unknown;
      }
    ).loader;

    expect(() => loader({ params: { id: 'org-1' } })).toThrow();
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/contacts',
      params: { id: 'org-1' },
    });
  });

  it('redirects /vendors to /contacts for the current org', async () => {
    const { Route } = await import('./vendors');
    const loader = (
      Route as unknown as {
        loader: (args: { params: { id: string } }) => unknown;
      }
    ).loader;

    expect(() => loader({ params: { id: 'org-2' } })).toThrow();
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/contacts',
      params: { id: 'org-2' },
    });
  });
});
