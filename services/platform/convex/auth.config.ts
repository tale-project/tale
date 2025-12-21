// For auth provider discovery, we use the internal URL when available.
// The Convex backend needs to reach this URL to discover the auth provider,
// and from inside Docker, the external SITE_URL may not be reachable due to
// hairpin NAT issues.
//
// CONVEX_SITE_URL_INTERNAL (http://127.0.0.1:3211) points directly to the
// Convex HTTP backend port within the container.
const authProviderDomain =
  process.env.CONVEX_SITE_URL_INTERNAL || process.env.CONVEX_SITE_URL;

export default {
  providers: [
    {
      domain: authProviderDomain,
      applicationID: 'convex',
    },
  ],
};
