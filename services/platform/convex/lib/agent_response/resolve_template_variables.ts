/**
 * Template Variable Resolution for Agent System Prompts
 *
 * Resolves {{variable}} patterns in agent instructions at runtime.
 * Only fetches external data (org, user, member) when the corresponding
 * variables are actually present in the instructions string.
 */

import { isRecord, getString } from '../../../lib/utils/type-utils';
import { components, internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
// Import from the function-free helper module (NOT `external_identities`, which
// defines convex functions) — this module is reachable from client code via the
// agent-instructions route, and importing the function module would ship those
// internalMutation/internalQuery definitions to the browser bundle.
import { isExternalOwnerId } from '../../identities/external_identities_helpers';
import {
  containsPlaceholder,
  substituteTemplate,
} from '../templating/substitute';

export interface TemplateContext {
  organizationId: string;
  userId?: string;
  timezone?: string;
  language?: string;
}

interface ResolvedData {
  organizationName?: string;
  userName?: string;
  userEmail?: string;
  userRole?: string;
}

export async function fetchOrganization(
  ctx: ActionCtx,
  organizationId: string,
): Promise<{ name?: string }> {
  const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });
  if (!isRecord(org)) return {};
  return { name: getString(org, 'name') };
}

export async function fetchUser(
  ctx: ActionCtx,
  userId: string,
): Promise<{ name?: string; email?: string }> {
  // External / sentinel owners (e.g. `slack:U123`, `'system'`) are not Better
  // Auth users — never hand them to the adapter (its `_id` lookup throws on
  // non-Convex-id strings). Resolve their display name from externalIdentities
  // when available so `{{user.name}}` still renders the real author.
  if (isExternalOwnerId(userId)) {
    const identity = await ctx.runQuery(
      internal.identities.external_identities.getByOwnerId,
      { ownerId: userId },
    );
    return identity?.displayName ? { name: identity.displayName } : {};
  }

  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: userId, operator: 'eq' }],
  });
  if (!isRecord(user)) return {};
  return { name: getString(user, 'name'), email: getString(user, 'email') };
}

export async function fetchMemberRole(
  ctx: ActionCtx,
  organizationId: string,
  userId: string,
): Promise<string | undefined> {
  // External / sentinel owners have no org membership role.
  if (isExternalOwnerId(userId)) return undefined;

  const member = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'member',
    where: [
      { field: 'organizationId', value: organizationId, operator: 'eq' },
      { field: 'userId', value: userId, operator: 'eq' },
    ],
  });
  if (!isRecord(member)) return undefined;
  return getString(member, 'role');
}

interface NeededData {
  needsOrg: boolean;
  needsUser: boolean;
  needsUserEmail: boolean;
  needsUserRole: boolean;
}

function detectNeededData(instructions: string): NeededData {
  const needsProfile = instructions.includes('{{user_profile}}');
  return {
    needsOrg: instructions.includes('{{organization.name}}') || needsProfile,
    needsUser: instructions.includes('{{user.name}}') || needsProfile,
    needsUserEmail: needsProfile,
    needsUserRole: needsProfile,
  };
}

export function buildUserProfile(
  context: TemplateContext,
  data: ResolvedData,
  /**
   * Whether to append the per-turn `- Current Time:` line. Defaults to `true`
   * for callers that embed this block in a volatile context (e.g. the workflow
   * engine). The chat system-prompt path passes `false`: there `{{user_profile}}`
   * is resolved into the CACHEABLE prefix, and a per-turn timestamp embedded
   * there would defeat prompt caching — the current time is injected separately
   * into the system prompt's volatile tail instead (see `buildSystemPrompt`).
   */
  includeCurrentTime = true,
): string {
  const lines: string[] = ['## Current User'];

  const nameIsEmail = data.userName && data.userName === data.userEmail;

  if (data.userName && !nameIsEmail) {
    lines.push(`- Name: ${data.userName}`);
  }
  if (data.userEmail) {
    lines.push(`- Email: ${data.userEmail}`);
  }
  if (data.userRole) {
    lines.push(`- Role: ${data.userRole}`);
  }
  if (data.organizationName) {
    lines.push(`- Organization: ${data.organizationName}`);
  }
  if (context.timezone) {
    lines.push(`- Timezone: ${context.timezone}`);
  }
  if (context.language) {
    lines.push(
      `- Browser locale: ${context.language} (for date/number formatting only — do NOT use this to determine response language)`,
    );
  }
  // The current time is per-turn volatile. Callers that place this block in a
  // volatile context keep it (default); the chat system-prompt path passes
  // `includeCurrentTime: false` and injects the time into the prompt's volatile
  // tail instead, so the `{{user_profile}}` block stays byte-stable and the
  // ~16K-token prefix remains prompt-cacheable. Everything above
  // (name/email/role/org/timezone/locale) is stable per (user, org).
  if (includeCurrentTime) {
    lines.push(`- Current Time: ${new Date().toISOString()}`);
  }

  return lines.join('\n');
}

function resolveVariable(
  variable: string,
  context: TemplateContext,
  data: ResolvedData,
): string | undefined {
  const trimmed = variable.trim();
  switch (trimmed) {
    case 'current_time':
      return new Date().toISOString();
    case 'current_date':
      return new Date().toISOString().slice(0, 10);
    case 'organization.id':
      return context.organizationId;
    case 'organization.name':
      return data.organizationName ?? '';
    case 'user.name':
      return data.userName ?? '';
    case 'user.timezone':
      return context.timezone ?? '';
    case 'user.language':
      return context.language ?? '';
    case 'user_profile':
      // Chat system prompt: omit the per-turn current time so this block stays
      // byte-stable in the cacheable prefix (the time is injected into the
      // system prompt's volatile tail by buildSystemPrompt instead).
      return buildUserProfile(context, data, false);
    case 'site_url': {
      const siteUrl = process.env.SITE_URL;
      if (!siteUrl)
        throw new Error('Missing required environment variable: SITE_URL');
      return siteUrl;
    }
    default:
      // Unknown variable: return undefined so the substitution engine leaves
      // the original `{{...}}` marker intact byte-for-byte.
      return undefined;
  }
}

export async function resolveTemplateVariables(
  ctx: ActionCtx,
  instructions: string,
  context: TemplateContext,
): Promise<string> {
  if (!containsPlaceholder(instructions)) {
    return instructions;
  }

  const { needsOrg, needsUser, needsUserEmail, needsUserRole } =
    detectNeededData(instructions);

  const [orgResult, userResult, memberRole] = await Promise.all([
    needsOrg ? fetchOrganization(ctx, context.organizationId) : undefined,
    needsUser && context.userId ? fetchUser(ctx, context.userId) : undefined,
    needsUserRole && context.userId
      ? fetchMemberRole(ctx, context.organizationId, context.userId)
      : undefined,
  ]);

  const data: ResolvedData = {
    organizationName: orgResult?.name,
    userName: userResult?.name,
    userEmail: needsUserEmail ? userResult?.email : undefined,
    userRole: memberRole ?? undefined,
  };

  return substituteTemplate(instructions, (name) =>
    resolveVariable(name, context, data),
  );
}

export const SUPPORTED_TEMPLATE_VARIABLES = [
  { variable: '{{current_time}}', description: 'Current ISO timestamp' },
  { variable: '{{current_date}}', description: 'Current date (YYYY-MM-DD)' },
  { variable: '{{organization.id}}', description: 'Organization ID' },
  { variable: '{{organization.name}}', description: 'Organization name' },
  { variable: '{{user.name}}', description: 'Current user name' },
  {
    variable: '{{user.timezone}}',
    description: 'User timezone (e.g. Asia/Shanghai)',
  },
  {
    variable: '{{user.language}}',
    description: 'User browser language (e.g. zh-CN)',
  },
  {
    variable: '{{user_profile}}',
    description: 'Complete user context as a prompt-ready text',
  },
  { variable: '{{site_url}}', description: 'Platform base URL' },
];
