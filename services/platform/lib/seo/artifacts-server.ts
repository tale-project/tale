/**
 * On-demand SEO + LLM artifact server for the Tale platform.
 *
 * The platform is an authenticated SPA — no public crawlable content
 * lives here. We still expose:
 *
 *   - `/llms.txt`       a minimal index pointing at the docs + marketing
 *                       sites and the GitHub repo,
 *   - `/llms-full.txt`  a single explanatory block (kept inline below),
 *   - `/robots.txt`     blanket `Disallow: /` so crawlers stay off the
 *                       authenticated surface.
 *
 * No sitemap is emitted (there's nothing to map). Output matches what
 * `services/web` and `services/docs` produce so every Tale service uses
 * the same on-demand mechanism.
 */

import { createArtifactsServer, type ArtifactsServer } from '@tale/seo';
import {
  TALE_DOCS_LLMS_FULL_TXT,
  TALE_DOCS_LLMS_TXT,
  TALE_GITHUB_URL,
  TALE_SITE_LLMS_FULL_TXT,
  TALE_SITE_LLMS_TXT,
  TALE_SITE_URL,
} from '@tale/seo/globals';

const SITE_TITLE = 'Tale Platform';
const SITE_DESCRIPTION =
  'Tale Platform — the self-hosted application for sovereign AI. Chat, custom agents, automations, and workspace tools running on your own infrastructure. This surface is the authenticated product; user-facing documentation lives on the docs site.';

const PLATFORM_INDEX_BODY = [
  'The platform is the authenticated product surface: chat with local AI models, build and version custom agents, automate workflows, manage a shared knowledge base, and administer members, teams, and providers. It is a single-page application — there is no public-facing content to index here.',
  '',
  "For LLM-readable documentation of the platform's capabilities, see:",
  '',
  `- ${TALE_DOCS_LLMS_TXT} — index of all documentation pages`,
  `- ${TALE_DOCS_LLMS_FULL_TXT} — full documentation content`,
  '',
  'For information about Tale as a product (pricing, hardware, contact), see:',
  '',
  `- ${TALE_SITE_LLMS_TXT}`,
  `- ${TALE_SITE_LLMS_FULL_TXT}`,
].join('\n');

export function createPlatformArtifactsServer(): ArtifactsServer {
  return createArtifactsServer({
    siteUrl: TALE_SITE_URL,
    siteTitle: SITE_TITLE,
    siteDescription: SITE_DESCRIPTION,
    loadRoutes: async () => ({
      sections: [
        {
          // Synthetic "page" carrying the explanatory body for
          // `/llms-full.txt`. `hideFromIndex` keeps it out of `llms.txt`,
          // which only shows the cross-link optional pages below.
          heading: 'Platform',
          hideFromIndex: true,
          routes: [
            {
              url: '/platform',
              title: SITE_TITLE,
              body: PLATFORM_INDEX_BODY,
            },
          ],
        },
      ],
      optionalPages: [
        { title: 'Documentation', url: TALE_DOCS_LLMS_TXT },
        { title: 'Marketing site', url: TALE_SITE_LLMS_TXT },
        { title: 'GitHub', url: TALE_GITHUB_URL },
      ],
    }),
    // Authenticated surface — block crawlers entirely.
    robots: { extraDisallow: ['/'] },
  });
}
