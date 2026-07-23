/**
 * Define RLS rules for all tables using convex-helpers
 */

import type { Rules } from 'convex-helpers/server/rowLevelSecurity';

import type { MemberRole } from '../../../../lib/shared/schemas/organizations';
import { isRecord } from '../../../../lib/utils/type-utils';
import type { DataModel, Doc, Id } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';
import { hasKnowledgeHubDocumentAccess } from '../../../documents/access';
import { getUserTeamIds } from '../../get_user_teams';
import { hasTeamAccess } from '../../team_access';
import { getAuthUserIdentity } from '../auth/get_auth_user_identity';
import { getUserOrganizations } from '../organization/get_user_organizations';
import type {
  AuthenticatedUser,
  OrganizationMember,
  RLSRuleContext,
} from '../types';
import { authorizeRls } from './access_control';
import { isAdmin } from './role_helpers';

/**
 * Define RLS rules for all tables
 * @param ctx - Query context
 * @param prefetchedData - Optional pre-fetched auth data to avoid duplicate queries
 */
export async function rlsRules(
  ctx: QueryCtx,
  prefetchedData?: {
    user: AuthenticatedUser | null;
    userOrganizations: Array<{
      organizationId: string;
      role: MemberRole;
      member: OrganizationMember;
    }>;
    userTeamIds?: Set<string>;
  },
): Promise<Rules<RLSRuleContext, DataModel>> {
  // Use pre-fetched data if available, otherwise fetch
  const user = prefetchedData?.user ?? (await getAuthUserIdentity(ctx));
  const userOrganizations =
    prefetchedData?.userOrganizations ??
    (user ? await getUserOrganizations(ctx, user) : []);
  const userOrgIds = new Set(
    userOrganizations.map((org) => org.organizationId),
  );

  // Team IDs cost a cross-component Better Auth round-trip, but only the
  // handful of team-scoped tables below (documents, promptTemplates,
  // promptCategories) ever consult them. The vast majority of wrapped queries
  // touch none of those tables, so resolving teams eagerly here burned a
  // round-trip per query for nothing. Resolve them lazily and memoize: the
  // cost is paid once, only when a team-scoped row policy actually runs.
  let teamIdsPromise: Promise<Set<string>> | undefined;
  const resolveTeamIds = (): Promise<Set<string>> => {
    if (prefetchedData?.userTeamIds) {
      return Promise.resolve(prefetchedData.userTeamIds);
    }
    return (teamIdsPromise ??= user?.userId
      ? getUserTeamIds(ctx, user.userId).then((ids) => new Set(ids))
      : Promise.resolve(new Set<string>()));
  };

  // Conversation access control (opt-in per org — the `conversation_access`
  // governance policy). One indexed configCache read per org per request,
  // memoized: when disabled the conversations rules short-circuit to today's
  // org-wide behaviour WITHOUT resolving teams (preserving the lazy-teams win).
  // configCache carries no RLS rule, so this reads on the raw ctx, exactly like
  // getUserTeamIds.
  const restrictAssignedPromises = new Map<string, Promise<boolean>>();
  const resolveRestrictAssigned = (orgId: string): Promise<boolean> => {
    let promise = restrictAssignedPromises.get(orgId);
    if (!promise) {
      promise = ctx.db
        .query('configCache')
        .withIndex('by_org_domain_key', (q) =>
          q
            .eq('organizationId', orgId)
            .eq('domain', 'governance')
            .eq('key', 'conversation_access'),
        )
        .first()
        .then((row) => {
          const config = row?.config;
          return isRecord(config) && config.restrictAssigned === true;
        });
      restrictAssignedPromises.set(orgId, promise);
    }
    return promise;
  };

  // Assignment-scope predicate, evaluated ONLY when the policy is on: admins and
  // owners see everything; an unassigned conversation is the shared org pool;
  // otherwise the caller must be the individual owner or a member of the queued
  // team (the union when both are set).
  const passesAssignmentScope = async (
    conversation: Doc<'conversations'>,
    role: MemberRole | undefined,
  ): Promise<boolean> => {
    if (isAdmin(role)) return true;
    const { assigneeUserId, assigneeTeamId } = conversation;
    if (!assigneeUserId && !assigneeTeamId) return true;
    if (assigneeUserId && assigneeUserId === user?.userId) return true;
    if (assigneeTeamId && (await resolveTeamIds()).has(assigneeTeamId)) {
      return true;
    }
    return false;
  };

  // Parent-conversation cache for conversationMessages scoping — one get per
  // conversation per request instead of one per message when a thread loads.
  const parentConversationPromises = new Map<
    string,
    Promise<Doc<'conversations'> | null>
  >();
  const getParentConversation = (
    conversationId: Id<'conversations'>,
  ): Promise<Doc<'conversations'> | null> => {
    const key = String(conversationId);
    let promise = parentConversationPromises.get(key);
    if (!promise) {
      promise = ctx.db.get(conversationId);
      parentConversationPromises.set(key, promise);
    }
    return promise;
  };

  return {
    // Documents - organization-scoped with team-based access control.
    // Project-scoped documents (projectId set) are denied outright: they are
    // not Knowledge Hub rows, and their read/edit paths go through the
    // project mutations' own guards (documents/access.ts), never through
    // RLS-wrapped db access. Defense-in-depth for future wrapped callers.
    documents: {
      read: async (_, doc) => {
        if (!user) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        if (!hasKnowledgeHubDocumentAccess(doc, await resolveTeamIds())) {
          return false;
        }
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'read');
      },
      modify: async (_, doc) => {
        if (!user) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        if (!hasKnowledgeHubDocumentAccess(doc, await resolveTeamIds())) {
          return false;
        }
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'write');
      },
      insert: async ({ user: ruleUser }, doc) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(doc.organizationId)) return false;
        if (!hasKnowledgeHubDocumentAccess(doc, await resolveTeamIds())) {
          return false;
        }
        const membership = userOrganizations.find(
          (m) => m.organizationId === doc.organizationId,
        );
        return authorizeRls(membership?.role, 'documents', 'write');
      },
    },

    // Projects - organization-scoped with team-based access control.
    // Per-project access (team-restriction reads) is enforced in the
    // dedicated `projects/access.ts` helpers — RLS here is the RBAC floor
    // (role + org membership). Mutation handlers further check
    // `hasProjectAccess` + admin gates for sharing/delete.
    projects: {
      read: async (_, project) => {
        if (!user) return false;
        if (!userOrgIds.has(project.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === project.organizationId,
        );
        return authorizeRls(membership?.role, 'projects', 'read');
      },
      modify: async (_, project) => {
        if (!user) return false;
        if (!userOrgIds.has(project.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === project.organizationId,
        );
        return authorizeRls(membership?.role, 'projects', 'write');
      },
      insert: async ({ user: ruleUser }, project) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(project.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === project.organizationId,
        );
        return authorizeRls(membership?.role, 'projects', 'write');
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

    // Contacts - organization-scoped
    contacts: {
      read: async (_, contact) => {
        if (!user) return false;
        if (!userOrgIds.has(contact.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === contact.organizationId,
        );
        return authorizeRls(membership?.role, 'contacts', 'read');
      },
      modify: async (_, contact) => {
        if (!user) return false;
        if (!userOrgIds.has(contact.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === contact.organizationId,
        );
        return authorizeRls(membership?.role, 'contacts', 'write');
      },
      insert: async ({ user: ruleUser }, contact) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(contact.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === contact.organizationId,
        );
        return authorizeRls(membership?.role, 'contacts', 'write');
      },
    },

    // Integrations - organization-scoped, Developer+ role required for modifications
    // Integration Credentials - organization-scoped, Developer+ role required for modifications
    integrationCredentials: {
      read: async (_, cred) => {
        if (!user) return false;
        if (!userOrgIds.has(cred.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === cred.organizationId,
        );
        return authorizeRls(membership?.role, 'integrationCredentials', 'read');
      },
      modify: async (_, cred) => {
        if (!user) return false;
        if (!userOrgIds.has(cred.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === cred.organizationId,
        );
        return authorizeRls(
          membership?.role,
          'integrationCredentials',
          'write',
        );
      },
      insert: async ({ user: ruleUser }, cred) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(cred.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === cred.organizationId,
        );
        return authorizeRls(
          membership?.role,
          'integrationCredentials',
          'write',
        );
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
        if (!authorizeRls(membership?.role, 'conversations', 'read')) {
          return false;
        }
        // Opt-in assignment privacy. Disabled ⇒ today's org-wide visibility
        // (no team resolve); enabled ⇒ scope to the owner / queued team / admin.
        if (!(await resolveRestrictAssigned(conversation.organizationId))) {
          return true;
        }
        return passesAssignmentScope(conversation, membership?.role);
      },
      modify: async (_, conversation) => {
        if (!user) return false;
        if (!userOrgIds.has(conversation.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === conversation.organizationId,
        );
        if (!authorizeRls(membership?.role, 'conversations', 'write')) {
          return false;
        }
        if (!(await resolveRestrictAssigned(conversation.organizationId))) {
          return true;
        }
        return passesAssignmentScope(conversation, membership?.role);
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
        if (!authorizeRls(membership?.role, 'conversationMessages', 'read')) {
          return false;
        }
        // Messages inherit their conversation's assignment privacy. Disabled ⇒
        // short-circuit (no parent get); enabled ⇒ scope by the parent, failing
        // closed if the parent has somehow vanished.
        if (!(await resolveRestrictAssigned(message.organizationId))) {
          return true;
        }
        const parent = await getParentConversation(message.conversationId);
        if (!parent) return false;
        return passesAssignmentScope(parent, membership?.role);
      },
      modify: async (_, message) => {
        if (!user) return false;
        if (!userOrgIds.has(message.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === message.organizationId,
        );
        if (!authorizeRls(membership?.role, 'conversationMessages', 'write')) {
          return false;
        }
        if (!(await resolveRestrictAssigned(message.organizationId))) {
          return true;
        }
        const parent = await getParentConversation(message.conversationId);
        if (!parent) return false;
        return passesAssignmentScope(parent, membership?.role);
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

    // Prompt Templates - organization-scoped, team-filtered
    promptTemplates: {
      read: async (_, prompt) => {
        if (!user) return false;
        if (!userOrgIds.has(prompt.organizationId)) return false;
        if (!hasTeamAccess(prompt, await resolveTeamIds())) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === prompt.organizationId,
        );
        return authorizeRls(membership?.role, 'promptTemplates', 'read');
      },
      modify: async (_, prompt) => {
        if (!user) return false;
        if (!userOrgIds.has(prompt.organizationId)) return false;
        if (!hasTeamAccess(prompt, await resolveTeamIds())) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === prompt.organizationId,
        );
        return authorizeRls(membership?.role, 'promptTemplates', 'write');
      },
      insert: async ({ user: ruleUser }, prompt) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(prompt.organizationId)) return false;
        if (!hasTeamAccess(prompt, await resolveTeamIds())) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === prompt.organizationId,
        );
        return authorizeRls(membership?.role, 'promptTemplates', 'write');
      },
    },

    // Prompt Categories - organization-scoped, scope-filtered
    // (personal: creator; team: team members; global: any org member).
    // Coarse RLS — the handler still does scope-specific create gating
    // (admins for team/global, creator-only for personal modify).
    promptCategories: {
      read: async (_, category) => {
        if (!user) return false;
        if (!userOrgIds.has(category.organizationId)) return false;
        if (category.scope === 'global') {
          // visible to any org member
        } else if (category.scope === 'team') {
          if (
            !category.teamId ||
            !(await resolveTeamIds()).has(category.teamId)
          )
            return false;
        } else if (category.scope === 'personal') {
          if (category.createdBy !== user.userId) return false;
        } else {
          return false;
        }
        const membership = userOrganizations.find(
          (m) => m.organizationId === category.organizationId,
        );
        return authorizeRls(membership?.role, 'promptCategories', 'read');
      },
      modify: async (_, category) => {
        if (!user) return false;
        if (!userOrgIds.has(category.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === category.organizationId,
        );
        if (!authorizeRls(membership?.role, 'promptCategories', 'write')) {
          return false;
        }
        // Mirror the scope model on the write path so the row policy
        // doesn't rely on every caller to remember the matrix:
        //   personal — only the creator
        //   team     — admins/owners of the org who are members of the team
        //   global   — admins/owners only
        const isAdminRole =
          membership?.role === 'admin' || membership?.role === 'owner';
        if (category.scope === 'personal') {
          return category.createdBy === user.userId;
        }
        if (category.scope === 'team') {
          if (!isAdminRole) return false;
          return (
            !!category.teamId && (await resolveTeamIds()).has(category.teamId)
          );
        }
        if (category.scope === 'global') {
          return isAdminRole;
        }
        return false;
      },
      insert: async ({ user: ruleUser }, category) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(category.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === category.organizationId,
        );
        if (!authorizeRls(membership?.role, 'promptCategories', 'write')) {
          return false;
        }
        const isAdminRole =
          membership?.role === 'admin' || membership?.role === 'owner';
        if (category.scope === 'personal') {
          return category.createdBy === ruleUser.userId;
        }
        if (category.scope === 'team') {
          if (!isAdminRole) return false;
          return (
            !!category.teamId && (await resolveTeamIds()).has(category.teamId)
          );
        }
        if (category.scope === 'global') {
          return isAdminRole;
        }
        return false;
      },
    },

    // Audit Log Chain Genesis - internal per-org serialization sentinel for
    // the audit hash chain (see audit_logs/schema.ts). Carries no user data.
    // Writes happen exclusively through internalMutation (createAuditLog),
    // which bypasses RLS, so the user-facing gate is deny-all. Surfacing
    // this sentinel to clients would leak per-org write-rate metadata
    // (round-2 R2-B8).
    auditLogChainGenesis: {
      read: async () => false,
      insert: async () => false,
      modify: async () => false,
    },

    // Audit Logs - organization-scoped, allow inserts for org members
    auditLogs: {
      read: async (_, log) => {
        if (!user) return false;
        if (!userOrgIds.has(log.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === log.organizationId,
        );
        return authorizeRls(membership?.role, 'auditLogs', 'read');
      },
      // Audit-log row content is immutable; the chain hash + verifyIntegrity
      // job enforce that. Convex-helpers RLS only sees the document, not the
      // patch diff, so we cannot block "edit field X" while allowing the
      // forward-chain link patch (chainSuccessor) that createAuditLog must
      // perform on the predecessor row to serialize concurrent writers via
      // OCC. Gate modify on org membership; any tampering with other fields
      // is caught by the next write's self-check against the recomputed hash.
      modify: async (_, log) => {
        if (!user) return false;
        return userOrgIds.has(log.organizationId);
      },
      insert: async ({ user: ruleUser }, log) => {
        if (!ruleUser) return false;
        if (!userOrgIds.has(log.organizationId)) return false;
        const membership = userOrganizations.find(
          (m) => m.organizationId === log.organizationId,
        );
        return authorizeRls(membership?.role, 'auditLogs', 'write');
      },
    },
  } satisfies Rules<RLSRuleContext, DataModel>;
}
