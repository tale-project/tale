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

/** Retire the former hardware pricing page without leaving published links as 404s. */
const HARDWARE_PRICING_REDIRECTS = {
  '/hardware-pricing': '/pricing',
  '/de/hardware-pricing': '/de/pricing',
  '/fr/hardware-pricing': '/fr/pricing',
} as const;

export function resolveWebRedirect(pathname: string): string | null {
  const normalizedPath = normalizeRequestPath(pathname);
  const hardwareTarget =
    HARDWARE_PRICING_REDIRECTS[
      normalizedPath as keyof typeof HARDWARE_PRICING_REDIRECTS
    ];
  if (hardwareTarget) return hardwareTarget;

  return UI_DOCS_ENTRY_PATHS.some((path) => path === normalizedPath)
    ? EXTERNAL_LINKS.uiDocs
    : null;
}

export const handleWebRedirect = createRedirectMapRoute({
  resolve: resolveWebRedirect,
  basePath: '',
});
