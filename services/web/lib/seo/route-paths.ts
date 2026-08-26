/**
 * Canonical English marketing paths. Shared by LocalizedLink and the
 * registry bijection test — keep in sync with ROUTE_SEO_KEYS in
 * marketing-routes.ts.
 */
export const ROUTE_PATHS = {
  '/': { en: '/', prefixed: '/$lang' },
  '/about': { en: '/about', prefixed: '/$lang/about' },
  '/pricing': { en: '/pricing', prefixed: '/$lang/pricing' },
  '/contact': { en: '/contact', prefixed: '/$lang/contact' },
  '/hardware-pricing': {
    en: '/hardware-pricing',
    prefixed: '/$lang/hardware-pricing',
  },
  '/request-demo': { en: '/request-demo', prefixed: '/$lang/request-demo' },
  '/platform': { en: '/platform', prefixed: '/$lang/platform' },
  '/platform/agents': {
    en: '/platform/agents',
    prefixed: '/$lang/platform/agents',
  },
  '/platform/chat': {
    en: '/platform/chat',
    prefixed: '/$lang/platform/chat',
  },
  '/platform/projects': {
    en: '/platform/projects',
    prefixed: '/$lang/platform/projects',
  },
  '/platform/automations': {
    en: '/platform/automations',
    prefixed: '/$lang/platform/automations',
  },
  '/platform/knowledge': {
    en: '/platform/knowledge',
    prefixed: '/$lang/platform/knowledge',
  },
  '/platform/governance': {
    en: '/platform/governance',
    prefixed: '/$lang/platform/governance',
  },
  '/changelog': { en: '/changelog', prefixed: '/$lang/changelog' },
} as const;

export type LocalizedRoutePath = keyof typeof ROUTE_PATHS;

export const LOCALIZED_ROUTE_PATHS = Object.keys(
  ROUTE_PATHS,
) as LocalizedRoutePath[];
