/**
 * Define RLS rules for all tables using convex-helpers
 */

import type { QueryCtx } from '../../../_generated/server';
import type { DataModel } from '../../../_generated/dataModel';
import { Rules } from 'convex-helpers/server/rowLevelSecurity';
import type { RLSRuleContext } from '../types';
import { getAuthenticatedUser } from '../auth/get_authenticated_user';
import { getUserOrganizations } from '../organization/get_user_organizations';
import { getUserTeamIds } from '../../get_user_teams';

import { authorizeRls } from '../../../auth';

/**
 * Define RLS rules for all tables
 */
export async function rlsRules(
  ctx: QueryCtx,
): Promise<Rules<RLSRuleContext, DataModel>> {
  const user = await getAuthenticatedUser(ctx);

  // If user is authenticated, get their organizations
  const userOrganizations = user ? await getUserOrganizations(ctx, user) : [];
  const userOrgIds = new Set(
    userOrganizations.map((org) => org.organizationId),
  );

  // Get user's team IDs for team-based access control on documents
  const userTeamIds = user?.userId
    ? new Set(await getUserTeamIds(ctx, user.userId))
    : new Set<string>();

  // Helper to check team access for documents
  // No teamTags or empty = accessible to all org members
  // Has teamTags = user must be in at least one of those teams
  const hasDocumentTeamAccess = (doc: { teamTags?: string[] }): boolean => {
    if (!doc.teamTags || doc.teamTags.length === 0) return true;
    return doc.teamTags.some((tag) => userTeamIds.has(tag));
  };

  return {
    // Documents - organization-scoped with team-based access control
    documents: {
      read: async (_, doc) => {
        if (!user) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        if (!hasDocumentTeamAccess(doc)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'read');
      },
      modify: async (_, doc) => {
        if (!user) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        if (!hasDocumentTeamAccess(doc)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'write');
      },
      insert: async ({ user: ruleUser }, doc) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        // User can only create documents with teamTags they belong to (or no teamTags)
        if (!hasDocumentTeamAccess(doc)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'write');
      },
    },

    // Products - organization-scoped
    products: {
      read: async (_, product) => {
        if (!user) return false;
        if (!userOrgIds.has(product.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === product.organizationId,
        );
        return authorizeRls(membership?.role, 'products', 'read');
      },
      modify: async (_, product) => {
        if (!user) return false;
        if (!userOrgIds.has(product.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === product.organizationId,
        );
        return authorizeRls(membership?.role, 'products', 'write');
      },
      insert: async ({ user: ruleUser }, product) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(product.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === product.organizationId,
        );
        return authorizeRls(membership?.role, 'products', 'write');
      },
    },

    // Customers - organization-scoped
    customers: {
      read: async (_, customer) => {
        if (!user) return false;
        if (!userOrgIds.has(customer.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === customer.organizationId,
        );
        return authorizeRls(membership?.role, 'customers', 'read');
      },
      modify: async (_, customer) => {
        if (!user) return false;
        if (!userOrgIds.has(customer.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === customer.organizationId,
        );
        return authorizeRls(membership?.role, 'customers', 'write');
      },
      insert: async ({ user: ruleUser }, customer) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(customer.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === customer.organizationId,
        );
        return authorizeRls(membership?.role, 'customers', 'write');
      },
    },

    // Vendors - organization-scoped
    vendors: {
      read: async (_, vendor) => {
        if (!user) return false;
        if (!userOrgIds.has(vendor.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === vendor.organizationId,
        );
        return authorizeRls(membership?.role, 'vendors', 'read');
      },
      modify: async (_, vendor) => {
        if (!user) return false;
        if (!userOrgIds.has(vendor.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === vendor.organizationId,
        );
        return authorizeRls(membership?.role, 'vendors', 'write');
      },
      insert: async ({ user: ruleUser }, vendor) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(vendor.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === vendor.organizationId,
        );
        return authorizeRls(membership?.role, 'vendors', 'write');
      },
    },

    // Integrations - organization-scoped, Developer+ role required for modifications
    integrations: {
      read: async (_, integration) => {
        if (!user) return false;
        if (!userOrgIds.has(integration.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === integration.organizationId,
        );
        return authorizeRls(membership?.role, 'integrations', 'read');
      },
      modify: async (_, integration) => {
        if (!user) return false;
        if (!userOrgIds.has(integration.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === integration.organizationId,
        );
        return authorizeRls(membership?.role, 'integrations', 'write');
      },
      insert: async ({ user: ruleUser }, integration) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(integration.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === integration.organizationId,
        );
        return authorizeRls(membership?.role, 'integrations', 'write');
      },
    },

    // Email Providers - organization-scoped, Developer+ role required
    emailProviders: {
      read: async (_, provider) => {
        if (!user) return false;
        if (!userOrgIds.has(provider.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === provider.organizationId,
        );
        return authorizeRls(membership?.role, 'emailProviders', 'read');
      },
      modify: async (_, provider) => {
        if (!user) return false;
        if (!userOrgIds.has(provider.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === provider.organizationId,
        );
        return authorizeRls(membership?.role, 'emailProviders', 'write');
      },
      insert: async ({ user: ruleUser }, provider) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(provider.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === provider.organizationId,
        );
        return authorizeRls(membership?.role, 'emailProviders', 'write');
      },
    },

    // OneDrive Sync Configs - organization-scoped
    onedriveSyncConfigs: {
      read: async (_, config) => {
        if (!user) return false;
        if (!userOrgIds.has(config.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === config.organizationId,
        );
        return authorizeRls(membership?.role, 'onedriveSyncConfigs', 'read');
      },
      modify: async (_, config) => {
        if (!user) return false;
        if (!userOrgIds.has(config.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === config.organizationId,
        );
        return authorizeRls(membership?.role, 'onedriveSyncConfigs', 'write');
      },
      insert: async ({ user: ruleUser }, config) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(config.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === config.organizationId,
        );
        return authorizeRls(membership?.role, 'onedriveSyncConfigs', 'write');
      },
    },

    // Conversations - organization-scoped
    conversations: {
      read: async (_, conversation) => {
        if (!user) return false;
        if (!userOrgIds.has(conversation.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === conversation.organizationId,
        );
        return authorizeRls(membership?.role, 'conversations', 'read');
      },
      modify: async (_, conversation) => {
        if (!user) return false;
        if (!userOrgIds.has(conversation.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === conversation.organizationId,
        );
        return authorizeRls(membership?.role, 'conversations', 'write');
      },
      insert: async ({ user: ruleUser }, conversation) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(conversation.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === conversation.organizationId,
        );
        return authorizeRls(membership?.role, 'conversations', 'write');
      },
    },

    // Conversation Messages - organization-scoped
    conversationMessages: {
      read: async (_, message) => {
        if (!user) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'conversationMessages', 'read');
      },
      modify: async (_, message) => {
        if (!user) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'conversationMessages', 'write');
      },
      insert: async ({ user: ruleUser }, message) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'conversationMessages', 'write');
      },
    },

    // Workflow Definitions - organization-scoped
    wfDefinitions: {
      read: async (_, wf) => {
        if (!user) return false;
        if (!userOrgIds.has(wf.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === wf.organizationId,
        );
        return authorizeRls(membership?.role, 'wfDefinitions', 'read');
      },
      modify: async (_, wf) => {
        if (!user) return false;
        if (!userOrgIds.has(wf.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === wf.organizationId,
        );
        return authorizeRls(membership?.role, 'wfDefinitions', 'write');
      },
      insert: async ({ user: ruleUser }, wf) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(wf.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === wf.organizationId,
        );
        return authorizeRls(membership?.role, 'wfDefinitions', 'write');
      },
    },

    // Workflow Step Definitions - organization-scoped
    wfStepDefs: {
      read: async (_, step) => {
        if (!user) return false;
        if (!userOrgIds.has(step.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === step.organizationId,
        );
        return authorizeRls(membership?.role, 'wfStepDefs', 'read');
      },
      modify: async (_, step) => {
        if (!user) return false;
        if (!userOrgIds.has(step.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === step.organizationId,
        );
        return authorizeRls(membership?.role, 'wfStepDefs', 'write');
      },
      insert: async ({ user: ruleUser }, step) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(step.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === step.organizationId,
        );
        return authorizeRls(membership?.role, 'wfStepDefs', 'write');
      },
    },

    // Workflow Executions - organization-scoped
    wfExecutions: {
      read: async (_, exec) => {
        if (!user) return false;
        if (!userOrgIds.has(exec.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === exec.organizationId,
        );
        return authorizeRls(membership?.role, 'wfExecutions', 'read');
      },
      modify: async (_, exec) => {
        if (!user) return false;
        if (!userOrgIds.has(exec.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === exec.organizationId,
        );
        return authorizeRls(membership?.role, 'wfExecutions', 'write');
      },
      insert: async ({ user: ruleUser }, exec) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(exec.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === exec.organizationId,
        );
        return authorizeRls(membership?.role, 'wfExecutions', 'write');
      },
    },

    // Workflow Approvals - organization-scoped
    approvals: {
      read: async (_, approval) => {
        if (!user) return false;
        if (!userOrgIds.has(approval.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === approval.organizationId,
        );
        return authorizeRls(membership?.role, 'approvals', 'read');
      },
      modify: async (_, approval) => {
        if (!user) return false;
        if (!userOrgIds.has(approval.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === approval.organizationId,
        );
        return authorizeRls(membership?.role, 'approvals', 'write');
      },
      insert: async ({ user: ruleUser }, approval) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(approval.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === approval.organizationId,
        );
        return authorizeRls(membership?.role, 'approvals', 'write');
      },
    },

    // Tone of Voice - organization-scoped
    toneOfVoice: {
      read: async (_, tone) => {
        if (!user) return false;
        if (!userOrgIds.has(tone.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === tone.organizationId,
        );
        return authorizeRls(membership?.role, 'toneOfVoice', 'read');
      },
      modify: async (_, tone) => {
        if (!user) return false;
        if (!userOrgIds.has(tone.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === tone.organizationId,
        );
        return authorizeRls(membership?.role, 'toneOfVoice', 'write');
      },
      insert: async ({ user: ruleUser }, tone) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(tone.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === tone.organizationId,
        );
        return authorizeRls(membership?.role, 'toneOfVoice', 'write');
      },
    },

    // Example Messages - organization-scoped
    exampleMessages: {
      read: async (_, message) => {
        if (!user) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'exampleMessages', 'read');
      },
      modify: async (_, message) => {
        if (!user) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'exampleMessages', 'write');
      },
      insert: async ({ user: ruleUser }, message) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        return authorizeRls(membership?.role, 'exampleMessages', 'write');
      },
    },

    // Websites - organization-scoped
    websites: {
      read: async (_, website) => {
        if (!user) return false;
        if (!userOrgIds.has(website.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === website.organizationId,
        );
        return authorizeRls(membership?.role, 'websites', 'read');
      },
      modify: async (_, website) => {
        if (!user) return false;
        if (!userOrgIds.has(website.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === website.organizationId,
        );
        return authorizeRls(membership?.role, 'websites', 'write');
      },
      insert: async ({ user: ruleUser }, website) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(website.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === website.organizationId,
        );
        return authorizeRls(membership?.role, 'websites', 'write');
      },
    },
  } satisfies Rules<RLSRuleContext, DataModel>;
}
