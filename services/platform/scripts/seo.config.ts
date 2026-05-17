/**
 * Build-time SEO config for the platform service. Consumed by
 * `tale-seo-compile` (`@tale/seo/bin/compile`) during the Docker builder
 * stage to materialise `dist-seo/`.
 *
 * Platform content is synthetic — all routes carry inline bodies — so
 * no `loadBody` is needed.
 */

import type { CompileToDiskParams } from '@tale/seo';

import {
  PLATFORM_SITE_DESCRIPTION,
  PLATFORM_SITE_TITLE,
  platformOptionalPages,
  platformRobots,
  platformSections,
  platformSiteUrl,
} from '../lib/seo/build';

export default function platformSeoConfig(): Omit<
  CompileToDiskParams,
  'outDir'
> {
  return {
    siteUrl: platformSiteUrl,
    siteTitle: PLATFORM_SITE_TITLE,
    siteDescription: PLATFORM_SITE_DESCRIPTION,
    sections: platformSections(),
    optionalPages: platformOptionalPages(),
    robots: platformRobots(),
  };
}
