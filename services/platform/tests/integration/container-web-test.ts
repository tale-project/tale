// =============================================================================
// Tale — Web container test
// =============================================================================
// Builds the web image via compose.web.yml + compose.web.test.yml, validates
// OCI labels / non-root / HEALTHCHECK / size, then smoke-tests /api/health
// and a handful of marketing HTTP probes (404, retired pricing redirect,
// localized platform, sitemap, OG).
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'web',
  port: 13001,
  sizeBudgetMb: 400,
  probes: [
    { path: '/nope', status: 404 },
    { path: '/platform', status: 200 },
    { path: '/de/platform', status: 200 },
    { path: '/pricing', status: 301 },
    { path: '/hardware-pricing', status: 404 },
    {
      path: '/sitemap.xml',
      status: 200,
      contentTypeIncludes: 'xml',
    },
    { path: '/og.png', status: 200 },
  ],
});
