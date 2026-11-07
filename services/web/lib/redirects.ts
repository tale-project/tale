import {
  createRedirectMapRoute,
  normalizeRequestPath,
} from '@tale/ui/docs/redirects';

import { EXTERNAL_LINKS } from './external-links';

/** Entry aliases for the English-only component guide; excluded from SEO. */
export const UI_DOCS_ENTRY_PATHS = [
  '/ui',
  '/en/ui',
  '/de/ui',
  '/fr/ui',
] as const;

/** Retire the pricing page without leaving published links as 404s. */
const PRICING_REDIRECTS = {
  '/pricing': '/',
  '/de/pricing': '/de',
  '/fr/pricing': '/fr',
} as const;

export function resolveWebRedirect(pathname: string): string | null {
  const normalizedPath = normalizeRequestPath(pathname);
  const pricingTarget =
    PRICING_REDIRECTS[normalizedPath as keyof typeof PRICING_REDIRECTS];
  if (pricingTarget) return pricingTarget;

  return UI_DOCS_ENTRY_PATHS.some((path) => path === normalizedPath)
    ? EXTERNAL_LINKS.uiDocs
    : null;
}

export const handleWebRedirect = createRedirectMapRoute({
  resolve: resolveWebRedirect,
  basePath: '',
});
