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

export function resolveWebRedirect(pathname: string): string | null {
  return UI_DOCS_ENTRY_PATHS.some(
    (path) => path === normalizeRequestPath(pathname),
  )
    ? EXTERNAL_LINKS.uiDocs
    : null;
}

export const handleWebRedirect = createRedirectMapRoute({
  resolve: resolveWebRedirect,
  basePath: '',
});
