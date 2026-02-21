/**
 * Template Variable Resolution for Agent System Prompts
 *
 * Resolves {{variable}} patterns in agent instructions at runtime.
 * Only fetches external data (org, user) when the corresponding
 * variables are actually present in the instructions string.
 */

import type { ActionCtx } from '../../_generated/server';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components } from '../../_generated/api';

const VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;
const VARIABLE_MARKER = '{{';

interface TemplateContext {
  organizationId: string;
  userId?: string;
}

interface ResolvedData {
  organizationName?: string;
  userName?: string;
}

async function fetchOrganization(
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

async function fetchUser(
  ctx: ActionCtx,
  userId: string,
): Promise<{ name?: string }> {
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: userId, operator: 'eq' }],
  });
  if (!isRecord(user)) return {};
  return { name: getString(user, 'name') };
}

function detectNeededData(instructions: string): {
  needsOrg: boolean;
  needsUser: boolean;
} {
  return {
    needsOrg: instructions.includes('{{organization.name}}'),
    needsUser: instructions.includes('{{user.name}}'),
  };
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

  const { needsOrg, needsUser } = detectNeededData(instructions);

  const [orgResult, userResult] = await Promise.all([
    needsOrg ? fetchOrganization(ctx, context.organizationId) : undefined,
    needsUser && context.userId ? fetchUser(ctx, context.userId) : undefined,
  ]);

  const data: ResolvedData = {
    organizationName: orgResult?.name,
    userName: userResult?.name,
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
];
