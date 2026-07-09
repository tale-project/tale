// =============================================================================
// Tale — Web container test
// =============================================================================
// Builds the web image via compose.web.yml + compose.web.test.yml, validates
// OCI labels / non-root / HEALTHCHECK / size, then smoke-tests /api/health
// and a handful of marketing HTTP probes (404, localized pricing, sitemap, OG).
// =============================================================================
import { runStaticSiteTest } from './static-site-test';

await runStaticSiteTest({
  name: 'web',
  port: 13001,
  sizeBudgetMb: 400,
  probes: [
    { path: '/nope', status: 404 },
    { path: '/pricing', status: 200 },
    { path: '/de/pricing', status: 200 },
    {
      path: '/sitemap.xml',
      status: 200,
      contentTypeIncludes: 'xml',
    },
    { path: '/og.png', status: 200 },
  ],
});
