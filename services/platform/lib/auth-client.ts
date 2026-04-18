import { apiKeyClient } from '@better-auth/api-key/client';
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
  integrations: ['read', 'write'],
  billing: ['read', 'write'],
  users: ['read', 'write'],
} as const;
const ac = createAccessControl(statement);
const admin = ac.newRole({
  content: ['read', 'write'],
  workflows: ['read', 'write'],
  integrations: ['read', 'write'],
  billing: ['read', 'write'],
  users: ['read', 'write'],
});
const developer = ac.newRole({
  content: ['read', 'write'],
  workflows: ['read', 'write'],
  integrations: ['read', 'write'],
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
  plugins: [
    convexClient(),
    apiKeyClient(),
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
