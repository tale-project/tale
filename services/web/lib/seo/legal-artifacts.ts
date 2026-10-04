import type { ArtifactsServer } from '@tale/ui/seo';

import { localizedPath, SUPPORTED_LOCALES } from '../i18n/locales';

const LEGAL_PREFIXES = SUPPORTED_LOCALES.map((locale) =>
  localizedPath(locale, '/legal/'),
);

/** Markdown cannot carry the legal page's HTML robots meta tag. Apply the
 * same noindex policy through HTTP in both dev and the precompiled server. */
export function withLegalArtifactNoindex(
  server: ArtifactsServer,
): ArtifactsServer {
  return {
    async handle(request) {
      const response = await server.handle(request);
      const { pathname } = new URL(request.url);
      if (
        !response ||
        !pathname.endsWith('.md') ||
        !LEGAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
      ) {
        return response;
      }
      const headers = new Headers(response.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
    invalidate: () => server.invalidate(),
  };
}
