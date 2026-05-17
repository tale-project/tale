interface MarketingRoute {
  /** Site-relative URL, e.g. `/`, `/pricing`. */
  url: string;
  title: string;
  description: string;
}

/**
 * Marketing routes the on-demand artifact server is allowed to serve.
 * Used by `lib/seo/artifacts-server.ts` for sitemap/llms.txt entries and
 * SSR-rendered `.md` exports. Legal pages live alongside as markdown
 * files under `app/content/legal/` and are picked up automatically.
 */
export const MARKETING_ROUTES: readonly MarketingRoute[] = [
  {
    url: '/',
    title: 'Tale: The Sovereign AI Platform',
    description:
      'Self-hosted AI platform for data-sensitive organisations — local AI models, agents, and automations on your own infrastructure.',
  },
  {
    url: '/pricing',
    title: 'Pricing',
    description:
      'One price for your entire team — no per-seat fees, no hidden costs.',
  },
  {
    url: '/hardware-pricing',
    title: 'Hardware pricing',
    description:
      'High-performance AI hardware — Quality, Hybrid, and Speed configurations.',
  },
  {
    url: '/contact',
    title: 'Contact',
    description: 'Get in touch with the Tale team.',
  },
  {
    url: '/request-demo',
    title: 'Request a demo',
    description:
      'Talk with a domain expert about your use case for sovereign AI.',
  },
];
