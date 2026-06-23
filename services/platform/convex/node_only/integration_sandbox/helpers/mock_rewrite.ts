/**
 * Optional redirect of outbound integration HTTP to the local mock gateway
 * (`lib/mocks`) for fully-offline e2e / container tests.
 *
 * Active only when `TALE_MOCK_INTEGRATIONS_BASE` is set (e.g.
 * `http://127.0.0.1:4141`); production and normal dev leave it unset, so
 * connectors hit the real upstream and this is a no-op.
 *
 * The host → mount-prefix table mirrors `packages/mocks/src/registry.ts`
 * (`MOCK_SPECS[].upstreamHosts` → `mountPrefix`). It is kept as a small local
 * copy so this Convex Node module needs no cross-package import (the mocks
 * package pulls in Prism, which must never enter the Convex bundle). The
 * per-connector contract tests redirect through this seam and fail end-to-end
 * if the two ever drift.
 */

interface HostMount {
  /** True when this mount stands in for the given upstream hostname. */
  readonly match: (hostname: string) => boolean;
  /** Gateway path prefix the rewritten URL is mounted under. */
  readonly mountPrefix: string;
}

const MOCK_HOST_MOUNTS: readonly HostMount[] = [
  { match: (h) => h === 'api.github.com', mountPrefix: '/mock/github' },
  { match: (h) => h === 'slack.com', mountPrefix: '/mock/slack' },
  {
    match: (h) => h === 'atlassian.net' || h.endsWith('.atlassian.net'),
    mountPrefix: '/mock/confluence',
  },
  { match: (h) => h === 'discord.com', mountPrefix: '/mock/discord' },
  // Teams + Outlook share the Graph host → one mock.
  {
    match: (h) => h === 'graph.microsoft.com',
    mountPrefix: '/mock/microsoft-graph',
  },
  { match: (h) => h === 'gmail.googleapis.com', mountPrefix: '/mock/gmail' },
  {
    match: (h) => h === 'www.googleapis.com',
    mountPrefix: '/mock/google-drive',
  },
  { match: (h) => h === 'api.twilio.com', mountPrefix: '/mock/twilio' },
  { match: (h) => h === 'api.tavily.com', mountPrefix: '/mock/tavily' },
  {
    match: (h) => h === 'myshopify.com' || h.endsWith('.myshopify.com'),
    mountPrefix: '/mock/shopify',
  },
];

/**
 * Rewrite an outbound upstream URL to the mock gateway, or return `null` when
 * the mock is disabled or no spec stands in for the host. The host/path/query
 * are preserved (only origin → `${base}${mountPrefix}`), so the gateway's Prism
 * instance matches the same operation the real API would.
 */
export function toMockUrl(url: string): string | null {
  const base = process.env.TALE_MOCK_INTEGRATIONS_BASE;
  if (!base) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const mount of MOCK_HOST_MOUNTS) {
    if (mount.match(parsed.hostname)) {
      const trimmed = base.replace(/\/$/, '');
      return `${trimmed}${mount.mountPrefix}${parsed.pathname}${parsed.search}`;
    }
  }
  return null;
}
