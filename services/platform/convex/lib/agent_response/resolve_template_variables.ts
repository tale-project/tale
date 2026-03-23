/**
 * Template Variable Resolution for Agent System Prompts
 *
 * Resolves {{variable}} patterns in agent instructions at runtime.
 * Only fetches external data (org, user, member) when the corresponding
 * variables are actually present in the instructions string.
 */

import type { ActionCtx } from '../../_generated/server';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components } from '../../_generated/api';

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;
const VARIABLE_MARKER = '{{';

export interface TemplateContext {
  organizationId: string;
  userId?: string;
  timezone?: string;
  language?: string;
  coordinates?: string;
  location?: string;
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
    lines.push(`- Language: ${context.language} (browser)`);
  }
  if (context.location || context.coordinates) {
    const loc = context.location
      ? context.coordinates
        ? `${context.location} (${context.coordinates})`
        : context.location
      : context.coordinates;
    lines.push(`- Location: ${loc}`);
  }
  lines.push(`- Current Time: ${new Date().toISOString()}`);

  return lines.join('\n');
}

function resolveVariable(
  variable: string,
  context: TemplateContext,
  data: ResolvedData,
): string {
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
    case 'user.coordinates':
      return context.coordinates ?? '';
    case 'user.location':
      return context.location ?? '';
    case 'user_profile':
      return buildUserProfile(context, data);
    case 'site_url': {
      const siteUrl = process.env.SITE_URL;
      if (!siteUrl)
        throw new Error('Missing required environment variable: SITE_URL');
      return siteUrl;
    }
    default:
      return `{{${variable}}}`;
  }
}

export async function resolveTemplateVariables(
  ctx: ActionCtx,
  instructions: string,
  context: TemplateContext,
): Promise<string> {
  if (!instructions.includes(VARIABLE_MARKER)) {
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

  return instructions.replace(VARIABLE_PATTERN, (_, variable: string) =>
    resolveVariable(variable, context, data),
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
    variable: '{{user.coordinates}}',
    description: 'User GPS coordinates (e.g. 30.27, 120.15)',
  },
  {
    variable: '{{user.location}}',
    description: 'User location address (e.g. Hangzhou, China)',
  },
  {
    variable: '{{user_profile}}',
    description: 'Complete user context as a prompt-ready text',
  },
  { variable: '{{site_url}}', description: 'Platform base URL' },
];
