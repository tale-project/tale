import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import { betterAuth } from 'better-auth';
import authSchema from './betterAuth/schema';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import authConfig from './auth.config';

import {
  defaultStatements,
  adminAc,
} from 'better-auth/plugins/organization/access';

const siteUrl = process.env.SITE_URL || 'http://127.0.0.1:3000';

// Define Better Auth Access Control (custom roles + permissions)
// Centralize table-keyed permissions used by RLS and the org plugin
// Only includes resources that exist in schema.ts
const platformResourceStatements = {
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
} as const;

const platformStatements = {
  ...defaultStatements,
  ...platformResourceStatements,
} as const;

const ac = createAccessControl(platformStatements);

const admin = ac.newRole({
  ...adminAc.statements,

  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
});

const developer = ac.newRole({
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
});

const editor = ac.newRole({
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  // integrations/providers/onedrive/workflow: read only
  integrations: ['read'],
  emailProviders: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read'],
  wfStepDefs: ['read'],
  wfExecutions: ['read'],
  workflowProcessingRecords: ['read'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
  // No access to: settings, automations (frontend menu restricted)
});

const member = ac.newRole({
  documents: ['read'],
  products: ['read'],
  customers: ['read'],
  vendors: ['read'],
  integrations: ['read'],
  emailProviders: ['read'],
  onedriveSyncConfigs: ['read'],
  conversations: ['read'],
  conversationMessages: ['read'],
  wfDefinitions: ['read'],
  wfStepDefs: ['read'],
  wfExecutions: ['read'],
  workflowProcessingRecords: ['read'],
  approvals: ['read'],
  toneOfVoice: ['read'],
  exampleMessages: ['read'],
  websites: ['read'],
  // No access to: settings, automations (frontend menu restricted)
});

const disabled = ac.newRole({
  documents: [],
  products: [],
  customers: [],
  vendors: [],
  integrations: [],
  emailProviders: [],
  onedriveSyncConfigs: [],
  conversations: [],
  conversationMessages: [],
  wfDefinitions: [],
  wfStepDefs: [],
  wfExecutions: [],
  workflowProcessingRecords: [],
  approvals: [],
  toneOfVoice: [],
  exampleMessages: [],
  websites: [],
});

export const platformRoles = {
  admin,
  developer,
  editor,
  member,
  disabled,
} as const;
export type PlatformRoleName = keyof typeof platformRoles;

// Roles mapping for the organization plugin (owner is implicit in plugin)
const orgRoles = {
  admin,
  developer,
  editor,
  member,
  disabled,
} as const;

export type PlatformTable = keyof typeof platformResourceStatements;
export type PlatformAction = 'read' | 'write';

export function authorizeRls(
  role: string | undefined,
  table: PlatformTable,
  action: PlatformAction,
): boolean {
  const normalized = (role ?? 'member').toLowerCase();
  const key: PlatformRoleName =
    normalized === 'admin' ||
    normalized === 'developer' ||
    normalized === 'editor' ||
    normalized === 'disabled'
      ? (normalized as PlatformRoleName)
      : 'member';
  const r = platformRoles[key];
  const req: any = { [table]: [action] };
  const res = (r as any).authorize(req);
  return !!res?.success;
}

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: {
      schema: authSchema,
    },
  },
);
// Helper function to get auth options (for createApi)
export const getAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Determine if we're running in HTTPS mode
  const isHttps = siteUrl.startsWith('https://');

  return {
    // disable logging when createAuth is called just to generate options.
    // this is not required, but there's a lot of noise in logs without it.
    logger: {
      disabled: true,
    },
    baseURL: siteUrl,
    // TEMPORARY: Allow requests from any host on port 3000
    // TODO: Replace with proper origin validation in production
    trustedOrigins: ['http://*', 'https://*'],
    database: authComponent.adapter(ctx),
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      microsoft: {
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID as string,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET as string,
        tenantId: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID as string,
        authority: 'https://login.microsoftonline.com',
        prompt: 'select_account' as const,
        scope: [
          'offline_access',
          'email',
          'https://graph.microsoft.com/Files.Read',
        ],
      },
    },
    advanced: {
      // Better Auth automatically adds __Secure- prefix when useSecureCookies is true
      // So we just use 'better-auth' as the base prefix
      cookiePrefix: 'better-auth',
      // Force secure cookies when running over HTTPS (this adds __Secure- prefix automatically)
      useSecureCookies: isHttps,
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({
        authConfig,
      }),
      organization({
        ac,
        roles: orgRoles,
        // Set the default role for organization creators to admin
        creatorRole: 'admin',
      }),
    ],
  };
};

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth(getAuthOptions(ctx));
};
