import type { ComponentProps, ElementType, MouseEvent, ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * A minimal `@tanstack/react-router` stand-in for component tests.
 *
 * Router-aware components render `Link`s, and a real `Link` throws outside a
 * router context — mounting a whole router per test would assert the router's
 * behaviour rather than the component's. The stub renders the same anchor the
 * router does (`to` → `href`) and drops the router-only props, so a role query
 * for a link finds exactly what a reader would.
 *
 * Use it from the module factory, which vitest hoists above the imports:
 *
 * ```ts
 * vi.mock('@tanstack/react-router', async () => {
 *   const { createRouterStub } = await import('@/tests/utils/router-stub');
 *   return createRouterStub('/current/path');
 * });
 * ```
 */
export function createRouterStub(pathname = '/') {
  const navigate = vi.fn();
  const Link = ({
    to,
    children,
    onClick,
    activeOptions: _activeOptions,
    _asChild: Anchor = 'a',
    preload: _preload,
    ...rest
  }: {
    to: string;
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    activeOptions?: unknown;
    _asChild?: ElementType;
    preload?: unknown;
  } & Record<string, unknown>) => (
    <Anchor
      href={to}
      // The real `Link` intercepts the click; without this jsdom logs
      // "Not implemented: navigation to another Document" on every row test.
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </Anchor>
  );
  return {
    Link,
    createLink:
      (Anchor: ElementType) => (props: ComponentProps<typeof Link>) => (
        <Link {...props} _asChild={Anchor} />
      ),
    useNavigate: () => navigate,
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { pathname: string } }) => unknown;
    }) => select({ location: { pathname } }),
    useLocation: () => ({ pathname }),
  };
}
