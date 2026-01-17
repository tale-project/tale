import { createAuthClient } from 'better-auth/react';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { organizationClient } from 'better-auth/client/plugins';
import { createAccessControl } from 'better-auth/plugins/access';

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

export const authClient = createAuthClient({
  // Requests are same-origin via Next.js rewrites; no crossDomain client needed
  // baseURL: appUrl,
  plugins: [
    convexClient(),
    organizationClient({
      ac,
      roles: {
        admin,
        developer,
        editor,
        member,
        disabled,
      },
      // Enable teams for multi-tenancy support (team-level data isolation)
      teams: {
        enabled: true,
      },
    }),
  ],
});
