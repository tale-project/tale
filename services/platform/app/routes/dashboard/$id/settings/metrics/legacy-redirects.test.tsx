import { describe, expect, it, vi } from 'vitest';

// Regression coverage for #2382: metrics consolidated under Settings →
// Metrics. Every legacy metrics URL — the governance Usage/Feedback pages and
// the pre-rework top-level `/agents/metrics` + `/automations/metrics` pages —
// must keep working for old bookmarks/links: each route's loader throws a
// `redirect()` into the new section, carrying the org id (and, where the
// target reads them, the search params) through. The section index redirects
// to its first tab.

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((opts: unknown) => opts),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  redirect: mockRedirect,
}));

interface LoaderArgs {
  params: { id: string };
  location: { search: Record<string, unknown> };
}

async function runLoader(
  importer: () => Promise<{ Route: unknown }>,
  args: LoaderArgs,
): Promise<void> {
  const { Route } = await importer();
  const loader = (Route as { loader: (args: LoaderArgs) => unknown }).loader;
  expect(() => loader(args)).toThrow();
}

describe('legacy metrics redirects (#2382)', () => {
  it('redirects /settings/governance/usage to /settings/metrics/usage', async () => {
    await runLoader(() => import('../governance/usage'), {
      params: { id: 'org-1' },
      location: { search: { period: '90' } },
    });
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/metrics/usage',
      params: { id: 'org-1' },
      search: { period: '90' },
    });
  });

  it('redirects /settings/governance/feedback to /settings/metrics/feedback', async () => {
    await runLoader(() => import('../governance/feedback'), {
      params: { id: 'org-2' },
      location: { search: { period: '30', agent: 'foo' } },
    });
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/metrics/feedback',
      params: { id: 'org-2' },
      search: { period: '30', agent: 'foo' },
    });
  });

  it('redirects the legacy /automations/metrics to /settings/metrics/automations', async () => {
    await runLoader(() => import('../../automations/metrics'), {
      params: { id: 'org-3' },
      location: { search: { period: '7' } },
    });
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/metrics/automations',
      params: { id: 'org-3' },
      search: { period: '7' },
    });
  });

  it('redirects the /settings/metrics index to the usage tab', async () => {
    await runLoader(() => import('./index'), {
      params: { id: 'org-5' },
      location: { search: {} },
    });
    expect(mockRedirect).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/metrics/usage',
      params: { id: 'org-5' },
    });
  });
});
