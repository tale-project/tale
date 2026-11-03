import type { ReactNode } from 'react';

import { createRouterStub } from '../../../../packages/ui/tests/utils/router-stub';

// Re-exported by name (not `export { createRouterStub }` of the import above):
// the test runner's module transform leaves that binding undefined.
export { createRouterStub } from '../../../../packages/ui/tests/utils/router-stub';

interface LinkProps {
  to: string;
  params?: Record<string, string>;
  children?: ReactNode;
  [prop: string]: unknown;
}

/**
 * The router stub of the test kit, with the `$param`s of a link's path filled
 * in from its `params`, so a test reads where a link goes (`/sessions/4`).
 * Use it from the factory of `vi.mock('@tanstack/react-router', …)`:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async () => {
 *   const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
 *   return createLinkingRouterStub('/proxies');
 * });
 * ```
 */
export function createLinkingRouterStub(pathname = '/') {
  const stub = createRouterStub(pathname);
  const StubLink = stub.Link;
  function Link({ to, params, children, ...rest }: LinkProps) {
    const href = to.replace(
      /\$(\w+)/g,
      (_match, name: string) => params?.[name] ?? '',
    );
    return (
      <StubLink to={href} {...rest}>
        {children}
      </StubLink>
    );
  }
  // A page that keeps its view in the address asks its route for it: the
  // stub's address has none, and a change of it goes nowhere.
  const getRouteApi = () => ({
    useSearch: () => ({}),
    useNavigate: () => stub.useNavigate(),
  });
  return { ...stub, Link, getRouteApi };
}
