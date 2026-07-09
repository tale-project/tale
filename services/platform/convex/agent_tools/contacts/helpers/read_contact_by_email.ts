import type { ToolCtx } from '@convex-dev/agent';

import { isKeyOf } from '../../../../lib/utils/type-utils';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { defaultGetFields, type ContactReadGetByEmailResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readContactByEmail(
  ctx: ToolCtx,
  args: { email: string; fields?: string[] },
): Promise<ContactReadGetByEmailResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for email-based contact search',
    );
  }

  debugLog('tool:contact_read get_by_email start', {
    organizationId,
    email: args.email,
  });

  const contact = await ctx.runQuery(
    internal.contacts.internal_queries.getContactByEmail,
    {
      organizationId,
      email: args.email,
    },
  );

  if (!contact) {
    debugLog('tool:contact_read get_by_email not found', {
      organizationId,
      email: args.email,
    });

    return {
      operation: 'get_by_email',
      contact: null,
    };
  }

  const fields = args.fields ?? defaultGetFields;

  // Build output with selected fields - contact type is known from query
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (isKeyOf(f, contact)) {
      out[f] = contact[f];
    }
  }
  if (!('_id' in out)) {
    out._id = contact._id;
  }

  const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
  debugLog('tool:contact_read get_by_email return', {
    email: args.email,
    presentKeys,
  });

  return {
    operation: 'get_by_email',
    contact: out,
  };
}
