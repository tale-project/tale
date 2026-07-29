/**
 * Canonical registry of every OpenAPI spec the mock gateway serves.
 *
 * Single source of truth for two consumers:
 *   1. `gateway.ts` — boots one Prism instance per spec, mounted at `mountPrefix`.
 *   2. The connector URL-rewrite contract — `upstreamHosts` maps a real third-party
 *      origin to its mock mount prefix so outbound connector calls can be redirected
 *      offline. (The Convex sandbox keeps a tiny prism-free mirror of this host→prefix
 *      map in `convex/node_only/connector_sandbox/helpers/mock_rewrite.ts`; the
 *      per-connector contract tests fail end-to-end if the two drift.)
 *
 * This module imports NOTHING heavy (no Prism) so it stays cheap to import.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'specs',
);

interface MockSpec {
  /**
   * Stable key. For connectors this matches the directory name under
   * `configs/platform/system/connectors/<name>`.
   */
  readonly name: string;
  /** Human label for logs. */
  readonly label: string;
  /** Absolute path to the OpenAPI 3.1 spec file. */
  readonly specPath: string;
  /**
   * Path prefix the gateway mounts this spec under. An incoming request whose
   * pathname starts with this prefix is routed to this spec's Prism instance
   * (with the prefix stripped before matching operations).
   */
  readonly mountPrefix: string;
  /**
   * Real upstream hosts this spec stands in for. The connector URL rewrite maps
   * `https://<host>/<path>` → `<gatewayBase><mountPrefix>/<path>`. A leading `*.`
   * matches any subdomain (e.g. `*.atlassian.net`). Empty for AI provider specs,
   * which are redirected via provider-config `baseUrl`, not host rewrite.
   */
  readonly upstreamHosts: readonly string[];
  /**
   * The base path the connector prepends to every call, preserved by the rewrite
   * so spec operation paths line up. e.g. Slack calls `https://slack.com/api/…`,
   * so the spec documents `/api/conversations.list`.
   */
  readonly category: 'provider' | 'connector';
}

function spec(file: string): string {
  return path.join(SPECS_DIR, file);
}

/**
 * Provider (AI) specs. One combined OpenAPI doc covers every OpenAI-compatible
 * endpoint because they all share one `baseUrl` in this codebase
 * (`convex/providers/resolve_model.ts`). The gateway mounts it at `/v1` and the
 * chat override intercepts `POST /v1/chat/completions` before Prism.
 */
const PROVIDER_SPECS: readonly MockSpec[] = [
  {
    name: 'openai-compat',
    label: 'OpenAI-compatible AI provider',
    specPath: spec('providers/openai-compat.openapi.yaml'),
    mountPrefix: '/v1',
    upstreamHosts: [],
    category: 'provider',
  },
];

/**
 * Third-party connector specs, trimmed to the operations our shipped
 * connectors (`configs/platform/system/connectors/<name>/connector.yml`) actually call.
 */
const CONNECTOR_SPECS: readonly MockSpec[] = [
  {
    name: 'github',
    label: 'GitHub REST API',
    specPath: spec('connectors/github.openapi.yaml'),
    mountPrefix: '/mock/github',
    upstreamHosts: ['api.github.com'],
    category: 'connector',
  },
  {
    name: 'slack',
    label: 'Slack Web API',
    specPath: spec('connectors/slack.openapi.yaml'),
    mountPrefix: '/mock/slack',
    upstreamHosts: ['slack.com'],
    category: 'connector',
  },
  {
    name: 'confluence',
    label: 'Confluence Cloud REST API',
    specPath: spec('connectors/confluence.openapi.yaml'),
    mountPrefix: '/mock/confluence',
    upstreamHosts: ['*.atlassian.net'],
    category: 'connector',
  },
  {
    name: 'discord',
    label: 'Discord API',
    specPath: spec('connectors/discord.openapi.yaml'),
    mountPrefix: '/mock/discord',
    upstreamHosts: ['discord.com'],
    category: 'connector',
  },
  {
    // Teams and Outlook both call the Microsoft Graph API on the same host, so
    // one spec serves both connectors.
    name: 'microsoft-graph',
    label: 'Microsoft Graph API (Teams + Outlook)',
    specPath: spec('connectors/microsoft-graph.openapi.yaml'),
    mountPrefix: '/mock/microsoft-graph',
    upstreamHosts: ['graph.microsoft.com'],
    category: 'connector',
  },
  {
    name: 'gmail',
    label: 'Gmail API',
    specPath: spec('connectors/gmail.openapi.yaml'),
    mountPrefix: '/mock/gmail',
    upstreamHosts: ['gmail.googleapis.com'],
    category: 'connector',
  },
  {
    name: 'google-drive',
    label: 'Google Drive API',
    specPath: spec('connectors/google-drive.openapi.yaml'),
    mountPrefix: '/mock/google-drive',
    upstreamHosts: ['www.googleapis.com'],
    category: 'connector',
  },
  {
    name: 'twilio',
    label: 'Twilio REST API',
    specPath: spec('connectors/twilio.openapi.yaml'),
    mountPrefix: '/mock/twilio',
    upstreamHosts: ['api.twilio.com'],
    category: 'connector',
  },
  {
    name: 'tavily',
    label: 'Tavily Search API',
    specPath: spec('connectors/tavily.openapi.yaml'),
    mountPrefix: '/mock/tavily',
    upstreamHosts: ['api.tavily.com'],
    category: 'connector',
  },
  {
    name: 'shopify',
    label: 'Shopify Admin REST API',
    specPath: spec('connectors/shopify.openapi.yaml'),
    mountPrefix: '/mock/shopify',
    upstreamHosts: ['*.myshopify.com'],
    category: 'connector',
  },
];

/**
 * Enterprise-SSO IdP specs. Like the AI provider spec, these are redirected via
 * config (an SSO connection's issuer / explicit endpoints point at the mount),
 * not host rewrite — so `upstreamHosts` is empty. Lets the SSO sign-in flow
 * (OIDC discovery → token → userinfo) run fully offline in e2e.
 */
const AUTH_SPECS: readonly MockSpec[] = [
  {
    name: 'sso-idp',
    label: 'Enterprise SSO IdP (OIDC)',
    specPath: spec('auth/oidc-idp.openapi.yaml'),
    mountPrefix: '/mock/sso-idp',
    upstreamHosts: [],
    category: 'provider',
  },
];

/** Every spec the gateway serves. */
export const MOCK_SPECS: readonly MockSpec[] = [
  ...PROVIDER_SPECS,
  ...AUTH_SPECS,
  ...CONNECTOR_SPECS,
];

/**
 * Resolve an outbound upstream URL to its mock URL, or `null` if no spec stands
 * in for that host. Pure (no I/O) so it is safe to import anywhere. The Convex
 * sandbox mirror implements the same logic against its local host map.
 */
export function resolveMockUrl(
  upstreamUrl: string,
  gatewayBase: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    return null;
  }
  for (const entry of MOCK_SPECS) {
    if (!hostMatches(parsed.hostname, entry.upstreamHosts)) continue;
    const base = gatewayBase.replace(/\/$/, '');
    return `${base}${entry.mountPrefix}${parsed.pathname}${parsed.search}`;
  }
  return null;
}

function hostMatches(hostname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".atlassian.net"
      return hostname.endsWith(suffix) || hostname === pattern.slice(2);
    }
    return hostname === pattern;
  });
}
