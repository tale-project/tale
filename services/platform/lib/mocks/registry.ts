/**
 * Canonical registry of every OpenAPI spec the mock gateway serves: the
 * OpenAI-compatible AI provider and the enterprise-SSO identity provider.
 * `gateway.ts` boots one Prism instance per spec, mounted at its `mountPrefix`.
 *
 * Connector APIs have no stand-in here: a run that must not reach a vendor
 * runs the connector's actions on their scenarios (CONN-R33).
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
  /** Stable key; names the spec's Prism instance in the gateway's logs. */
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
}

function spec(file: string): string {
  return path.join(SPECS_DIR, file);
}

/**
 * Provider (AI) specs. One combined OpenAPI doc covers every OpenAI-compatible
 * endpoint because they all share one provider `baseUrl` (the e2e fixture
 * `tests/e2e/fixtures/config/default/providers/e2e-mock.yml` sets it to the
 * gateway's `/v1`). The gateway mounts it at `/v1` and the chat override
 * intercepts `POST /v1/chat/completions` before Prism.
 */
const PROVIDER_SPECS: readonly MockSpec[] = [
  {
    name: 'openai-compat',
    label: 'OpenAI-compatible AI provider',
    specPath: spec('providers/openai-compat.openapi.yaml'),
    mountPrefix: '/v1',
  },
];

/**
 * Enterprise-SSO IdP specs. An SSO connection's issuer (or its explicit
 * endpoints) points at the mount, so the SSO sign-in flow (OIDC discovery →
 * token → userinfo) runs fully offline in e2e.
 */
const AUTH_SPECS: readonly MockSpec[] = [
  {
    name: 'sso-idp',
    label: 'Enterprise SSO IdP (OIDC)',
    specPath: spec('auth/oidc-idp.openapi.yaml'),
    mountPrefix: '/mock/sso-idp',
  },
];

/** Every spec the gateway serves. */
export const MOCK_SPECS: readonly MockSpec[] = [
  ...PROVIDER_SPECS,
  ...AUTH_SPECS,
];
