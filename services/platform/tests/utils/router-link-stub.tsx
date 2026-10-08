import { createElement, type ReactNode } from 'react';

/**
 * Stand-ins for a router link and the router, for component suites that
 * mount no RouterProvider but render a control that is a real `Link` (the
 * task dialog's Open as page) or builds an address (Copy link). Spread into a
 * `vi.mock('@tanstack/react-router', …)` factory after the original module:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async (importOriginal) => ({
 *   ...(await importOriginal<typeof import('@tanstack/react-router')>()),
 *   ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
 * }));
 * ```
 *
 * The link renders a plain anchor that keeps its other props (name, class,
 * handlers), so a suite can find it by role and name.
 */
export const routerLinkStub = {
  Link: ({
    children,
    to: _to,
    params: _params,
    search: _search,
    ...props
  }: {
    children?: ReactNode;
    to?: unknown;
    params?: unknown;
    search?: unknown;
    [key: string]: unknown;
  }) => createElement('a', { href: '#', ...props }, children),
  useRouter: () => ({ buildLocation: () => ({ href: '/' }) }),
};
