import { vi } from 'vitest';

import { createLinkingRouterStub } from './router-stub';

/**
 * The router the component tests of the sessions share: the kit's linking
 * stub (links resolve their parameters the way the router does:
 * `/sessions/$sessionId` + `{ sessionId: '4' }` is `/sessions/4`), the path the
 * test says is open, one `navigate` to assert on, and an `Outlet`.
 *
 * Use it from the module factory, which vitest hoists above the imports:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async () =>
 *   (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
 * );
 * ```
 */
let pathname = '/sessions';

/** The path the router reports as open, for the test that follows. */
export function setOpenPath(next: string): void {
  pathname = next;
}

/** Every call to `navigate` since the last `navigate.mockClear()`. */
export const navigate = vi.fn();

export function createSessionsRouterMock() {
  return {
    ...createLinkingRouterStub(),
    useNavigate: () => navigate,
    useLocation: () => ({ pathname }),
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => unknown;
    }) => select({ location: { pathname } }),
    // Stands for the page that is open beside the list.
    Outlet: () => <div role="region" aria-label="Open page" />,
  };
}
