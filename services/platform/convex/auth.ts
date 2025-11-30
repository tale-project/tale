import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import { betterAuth } from 'better-auth';
import authSchema from './betterAuth/schema';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';

import {
  defaultStatements,
  adminAc,
} from 'better-auth/plugins/organization/access';

const siteUrl = process.env.SITE_URL || 'http://127.0.0.1:3000';

// Define Better Auth Access Control (custom roles + permissions)
// Centralize table-keyed permissions used by RLS and the org plugin
const platformResourceStatements = {
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  subscriptions: ['read', 'write'],
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  automations: ['read', 'write'],

  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],

  productRelationships: ['read', 'write'],
  settings: ['read', 'write'],
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
  subscriptions: ['read', 'write'],
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],

  automations: ['read', 'write'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
  productRelationships: ['read', 'write'],
  settings: ['read', 'write'],
});

const developer = ac.newRole({
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  // subscriptions intentionally omitted for write
  integrations: ['read', 'write'],
  emailProviders: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'],
  wfStepDefs: ['read', 'write'],
  wfExecutions: ['read', 'write'],
  workflowProcessingRecords: ['read', 'write'],

  automations: ['read', 'write'],
  approvals: ['read', 'write'],
  toneOfVoice: ['read', 'write'],
  exampleMessages: ['read', 'write'],
  websites: ['read', 'write'],
  productRelationships: ['read', 'write'],
  settings: ['read'],
});

const editor = ac.newRole({
  documents: ['read', 'write'],
  products: ['read', 'write'],
  customers: ['read', 'write'],
  vendors: ['read', 'write'],
  // subs/integrations/providers/onedrive/workflow: read only
  subscriptions: ['read'],
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
  productRelationships: ['read', 'write'],
  settings: ['read'],
});

const member = ac.newRole({
  documents: ['read'],
  products: ['read'],
  customers: ['read'],
  vendors: ['read'],
  subscriptions: ['read'],
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
  productRelationships: ['read'],
  settings: ['read'],
});

const disabled = ac.newRole({
  documents: [],
  products: [],
  customers: [],
  vendors: [],
  subscriptions: [],
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
  productRelationships: [],
  settings: [],
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
export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  // Determine if we're running in HTTPS mode
  const isHttps = siteUrl.startsWith('https://');

  return betterAuth({
    // disable logging when createAuth is called just to generate options.
    // this is not required, but there's a lot of noise in logs without it.
    logger: {
      disabled: optionsOnly,
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
        prompt: 'consent',
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
      convex(),
      organization({
        ac,
        roles: orgRoles,
        // Set the default role for organization creators to admin
        creatorRole: 'admin',
      }),
    ],
  });
};
