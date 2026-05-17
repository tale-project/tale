/**
 * Shared SEO config for the platform — content is synthetic (no public
 * surface, no markdown to walk). Both the dev on-demand server and the
 * build-time precompile CLI consume this module so output stays
 * consistent.
 */

import type { ArtifactSection, OptionalPage, RobotsConfig } from '@tale/seo';
import {
  TALE_DOCS_LLMS_FULL_TXT,
  TALE_DOCS_LLMS_TXT,
  TALE_GITHUB_URL,
  TALE_SITE_LLMS_FULL_TXT,
  TALE_SITE_LLMS_TXT,
  TALE_SITE_URL,
} from '@tale/seo/globals';

export const PLATFORM_SITE_TITLE = 'Tale Platform';
export const PLATFORM_SITE_DESCRIPTION =
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

export function platformSections(): ArtifactSection[] {
  return [
    {
      heading: 'Platform',
      // Hidden from the `llms.txt` index — that file only shows the
      // optional cross-links below. The synthetic route still carries
      // the body for `/llms-full.txt`.
      hideFromIndex: true,
      routes: [
        {
          url: '/platform',
          title: PLATFORM_SITE_TITLE,
          body: PLATFORM_INDEX_BODY,
        },
      ],
    },
  ];
}

export function platformOptionalPages(): OptionalPage[] {
  return [
    { title: 'Documentation', url: TALE_DOCS_LLMS_TXT },
    { title: 'Marketing site', url: TALE_SITE_LLMS_TXT },
    { title: 'GitHub', url: TALE_GITHUB_URL },
  ];
}

export function platformRobots(): RobotsConfig {
  // Authenticated surface — block crawlers entirely.
  return { extraDisallow: ['/'] };
}

export const platformSiteUrl = TALE_SITE_URL;
