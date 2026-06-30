import enMessages from '../../messages/en.json';

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
 */
const ROUTE_SEO_KEYS = [
  { url: '/', key: 'home' },
  { url: '/pricing', key: 'pricing' },
  { url: '/hardware-pricing', key: 'hardwarePricing' },
  { url: '/contact', key: 'contact' },
  { url: '/request-demo', key: 'requestDemo' },
] as const;

const seo = enMessages.seo;

export const MARKETING_ROUTES: readonly MarketingRoute[] = ROUTE_SEO_KEYS.map(
  ({ url, key }) => ({
    url,
    title: seo[key].title,
    description: seo[key].description,
  }),
);
