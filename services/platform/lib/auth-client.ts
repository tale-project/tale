import { apiKeyClient } from '@better-auth/api-key/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import {
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { createAuthClient } from 'better-auth/react';

// Mirror minimal access control on the client for type-safe checks
const statement = {
  content: ['read', 'write'],
  workflows: ['read', 'write'],
  connectors: ['read', 'write'],
  billing: ['read', 'write'],
  users: ['read', 'write'],
} as const;
const ac = createAccessControl(statement);
const admin = ac.newRole({
  content: ['read', 'write'],
  workflows: ['read', 'write'],
  connectors: ['read', 'write'],
  billing: ['read', 'write'],
  users: ['read', 'write'],
});
const developer = ac.newRole({
  content: ['read', 'write'],
  workflows: ['read', 'write'],
  connectors: ['read', 'write'],
});
const editor = ac.newRole({
  content: ['read', 'write'],
});
const member = ac.newRole({
  content: ['read'],
});
const disabled = ac.newRole({ content: [] });

const basePath = window.__ENV__?.BASE_PATH ?? '';

export const authClient = createAuthClient({
  baseURL: basePath
    ? `${window.location.origin}${basePath}/api/auth`
    : undefined,
  // Retry transient failures (5xx / unreachable backend) inside the fetch
  // layer. On cold start the backend can briefly answer 502/503 while
  // functions, env vars and the JWKS bootstrap settle — and two consumers
  // latch the FIRST result forever: the auth provider's session atom never
  // refetches on its own, and its Convex token fetch is only rebuilt when the
  // session id changes. A single failed hop therefore used to strand the
  // websocket unauthenticated (endless skeletons) until a manual reload.
  // Retrying here keeps those one-shot fetches pending until the backend is
  // actually up. 4xx (signed out, bad request) is never retried.
  fetchOptions: {
    retry: {
      type: 'exponential',
      attempts: 4,
      baseDelay: 500,
      maxDelay: 4000,
      shouldRetry: (response) => response === null || response.status >= 500,
    },
  },
  plugins: [
    convexClient(),
    apiKeyClient(),
    // WebAuthn / passkeys (#1508). Exposes authClient.passkey.* for the
    // registration + authentication ceremonies the browser drives.
    passkeyClient(),
    twoFactorClient({
      // Hook runs before the caller's .then() resolves, but the caller also
      // still receives `{ twoFactorRedirect: true }` in the response data —
      // log-in.tsx branches on that explicitly to avoid double-navigation and
      // to preserve the current `redirectTo` query param.
      onTwoFactorRedirect() {
        const base = window.__ENV__?.BASE_PATH ?? '';
        window.location.href = `${base}/2fa`;
      },
    }),
    organizationClient({
      ac,
      roles: {
        owner: admin,
        admin,
        developer,
        editor,
        member,
        disabled,
      },
      // Enable teams for multi-tenancy support (team-level data isolation)
      teams: {
        enabled: true,
        allowRemovingAllTeams: true,
        defaultTeam: {
          enabled: false,
        },
      },
    }),
  ],
});
