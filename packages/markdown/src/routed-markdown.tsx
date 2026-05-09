import { Link } from '@tanstack/react-router';
import { type ComponentPropsWithoutRef } from 'react';
import type { Components } from 'react-markdown';

import { Markdown } from './markdown';

interface RoutedMarkdownProps {
  children: string;
  /** Override or extend the component map. Merged on top of the router-aware
   * `a` override so consumers can still customise individual elements. */
  components?: Components;
  className?: string;
}

const ROUTER_LINK_CLASS =
  'text-fg-base underline underline-offset-4 hover:no-underline';

/**
 * SPA-aware anchor used by docs/web. External `http(s)://` and bare
 * fragment (`#anchor`) hrefs render as plain `<a>` so target=_blank still
 * works and on-page anchors don't go through the router; everything else
 * defers to TanStack Router's `<Link>` for client-side navigation.
 */
/**
 * Match any URI scheme (http, https, mailto, tel, ftp, sms, …) and the
 * protocol-relative `//host` form. Anything that hits this RegExp must
 * stay a plain `<a>`; only "real" internal app paths go through the
 * router.
 */
const NON_INTERNAL_HREF_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

function RoutedAnchor({ href, children }: ComponentPropsWithoutRef<'a'>) {
  const isExternal =
    typeof href === 'string' && NON_INTERNAL_HREF_RE.test(href);
  const isHttpExternal =
    typeof href === 'string' &&
    (href.startsWith('http://') || href.startsWith('https://'));
  const isHash = typeof href === 'string' && href.startsWith('#');

  if (!href || isExternal || isHash) {
    return (
      <a
        href={href}
        target={isHttpExternal ? '_blank' : undefined}
        rel={isHttpExternal ? 'noopener noreferrer' : undefined}
        className={ROUTER_LINK_CLASS}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
      to={href as any}
      className={ROUTER_LINK_CLASS}
    >
      {children}
    </Link>
  );
}

const ROUTED_COMPONENTS = { a: RoutedAnchor } satisfies Components;

/**
 * `<Markdown>` wrapper that swaps internal `<a>` for TanStack-Router's
 * `<Link>` so consumers inside a `<RouterProvider>` get SPA navigation
 * for free. Storybook / SSR-without-router contexts should keep using
 * the base `<Markdown>` from `@tale/markdown/markdown`.
 */
export function RoutedMarkdown({
  children,
  components,
  className,
}: RoutedMarkdownProps) {
  return (
    <Markdown
      className={className}
      components={{ ...ROUTED_COMPONENTS, ...components }}
    >
      {children}
    </Markdown>
  );
}
