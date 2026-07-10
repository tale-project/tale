import type { ToolCtx } from '@convex-dev/agent';

import { isKeyOf } from '../../../../lib/utils/type-utils';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { defaultGetFields, type ContactReadGetByIdResult } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function readContactById(
  ctx: ToolCtx,
  args: { contactId: string; fields?: string[] },
): Promise<ContactReadGetByIdResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for id-based contact lookup',
    );
  }

  debugLog('tool:contact_read get_by_id start', {
    organizationId,
    contactId: args.contactId,
  });

  const contactId = toId<'contacts'>(args.contactId);

  // Pass callerOrgId so the query refuses to return a contact from another
  // organization (closes the cross-org IDOR on id-based lookups).
  const contact = await ctx.runQuery(
    internal.contacts.internal_queries.getContactById,
    { contactId, callerOrgId: organizationId },
  );

  if (!contact) {
    debugLog('tool:contact_read get_by_id not found', {
      organizationId,
      contactId: args.contactId,
    });

    return {
      operation: 'get_by_id',
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
  debugLog('tool:contact_read get_by_id return', {
    contactId: args.contactId,
    presentKeys,
  });

  return {
    operation: 'get_by_id',
    contact: out,
  };
}
