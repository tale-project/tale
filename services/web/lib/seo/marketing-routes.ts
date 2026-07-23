import enMessages from '../../messages/en.yml';

interface MarketingRoute {
  /** Site-relative URL, e.g. `/`, `/pricing`. */
  url: string;
  title: string;
  description: string;
}

/**
 * Marketing routes the on-demand artifact server is allowed to serve.
 * Used by `lib/seo/artifacts-server.ts` for sitemap/llms.txt entries and by
 * `scripts/prerender.ts` for the static route list. Legal pages live
 * alongside as markdown under `app/content/legal/` and are picked up
 * automatically.
 *
 * Title + description come from the `seo` i18n namespace — the exact strings
 * each page renders via `useT('seo')` + `useDocumentMeta` — so the sitemap,
 * llms.txt, and the prerendered `<head>` all describe a page identically.
 * There is no second copy to drift.
 *
 * Keep this list in bijection with `ROUTE_PATHS` in
 * `lib/seo/route-paths.ts` — `marketing-routes.test.ts` guards the pairing.
 */
const ROUTE_SEO_KEYS = [
  { url: '/', key: 'home' },
  { url: '/pricing', key: 'pricing' },
  { url: '/hardware-pricing', key: 'hardwarePricing' },
  { url: '/contact', key: 'contact' },
  { url: '/request-demo', key: 'requestDemo' },
  { url: '/platform', key: 'platform' },
  { url: '/platform/agents', key: 'platformAgents' },
  { url: '/platform/chat', key: 'platformChat' },
  { url: '/platform/projects', key: 'platformProjects' },
  { url: '/platform/automations', key: 'platformAutomations' },
  { url: '/platform/knowledge', key: 'platformKnowledge' },
  { url: '/platform/governance', key: 'platformGovernance' },
  { url: '/changelog', key: 'changelog' },
] as const;

const seo = enMessages.seo;

export const MARKETING_ROUTES: readonly MarketingRoute[] = ROUTE_SEO_KEYS.map(
  ({ url, key }) => ({
    url,
    title: seo[key].title,
    description: seo[key].description,
  }),
);

/** Exported for the registry bijection test. */
export const MARKETING_ROUTE_URLS = ROUTE_SEO_KEYS.map((r) => r.url);
