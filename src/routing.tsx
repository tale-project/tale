import { Link } from '@tanstack/react-router';
import {
  type ComponentPropsWithoutRef,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from 'react';

/**
 * The props every internal marketing link renders through. `to` is a site
 * path (`/pricing`, `/platform/agents`); how it becomes a URL — locale
 * prefixes, a typed route table — is the host's business, so the host mounts
 * `MarketingRouterProvider` with its own link component and the package
 * never learns about its routes.
 */
export interface MarketingLinkComponentProps extends Omit<
  ComponentPropsWithoutRef<'a'>,
  'href'
> {
  to: string;
  /**
   * Props applied while the link's target is the current location — the
   * TanStack `activeProps` contract, which `MarketingLink` uses for its
   * `active` nav styling.
   */
  activeProps?: { className?: string };
}

export type MarketingLinkComponent = ComponentType<MarketingLinkComponentProps>;

/**
 * Default: TanStack Router's `Link` with the path verbatim. A host that
 * augments `Register` (typed routes) supplies its own component through the
 * provider; inside this package no router is registered, so a plain string
 * `to` is what `Link` accepts.
 */
function RouterLink({ to, ...rest }: MarketingLinkComponentProps) {
  return <Link to={to} {...rest} />;
}

const MarketingRouterContext =
  createContext<MarketingLinkComponent>(RouterLink);

interface MarketingRouterProviderProps {
  /** The component every `MarketingLink` / linked card / CTA renders as. */
  link: MarketingLinkComponent;
  children: ReactNode;
}

/**
 * Injects the host's link component into the marketing primitives.
 * `services/web` mounts it once in its root route with a `LocalizedLink`
 * adapter; a site without locale prefixes can leave it out and get TanStack's
 * `Link`.
 */
export function MarketingRouterProvider({
  link,
  children,
}: MarketingRouterProviderProps) {
  return (
    <MarketingRouterContext.Provider value={link}>
      {children}
    </MarketingRouterContext.Provider>
  );
}

/** The link component in scope — `MarketingRouterProvider`'s or the default. */
export function useMarketingLink(): MarketingLinkComponent {
  return useContext(MarketingRouterContext);
}
