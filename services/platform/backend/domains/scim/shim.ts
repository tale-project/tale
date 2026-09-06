import type { Sql } from 'postgres';
import { z } from 'zod';

import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import {
  deleteGroup,
  deprovisionUser,
  findGroupRecordByDisplayName,
  findUserRecordByUserName,
  getGroupRecord,
  getUserRecord,
  listGroupRecords,
  listUserRecords,
  patchGroup,
  patchUser,
  provisionGroup,
  provisionUser,
  replaceGroup,
} from './service.ts';

/**
 * Shim handlers for the REUSED 0.4 SCIM dispatcher bodies: every
 * `internal.scim.*` ref they call, answered by the PG service twins. Token
 * auth + last-used stamping happen in the 0.5 route wrapper, so those two
 * refs never fire here.
 */
export function scimShimHandlers(sql: Sql): ShimHandlers {
  const org = z.object({ organizationId: z.string() });
  // The RFC 7644 page the dispatcher already clamped (count ≤ 200).
  const page = org.extend({
    offset: z.number().int().min(0),
    limit: z.number().int().min(0).max(200),
  });
  return {
    'scim/internal_queries:getUserRecord': async (raw) => {
      const args = org.extend({ userId: z.string() }).parse(raw);
      return getUserRecord(sql, args.organizationId, args.userId);
    },
    'scim/internal_queries:findUserRecordByUserName': async (raw) => {
      const args = org.extend({ userName: z.string() }).parse(raw);
      return findUserRecordByUserName(sql, args.organizationId, args.userName);
    },
    'scim/internal_queries:listUserRecords': async (raw) => {
      const { organizationId, ...pageArgs } = page.parse(raw);
      return listUserRecords(sql, organizationId, pageArgs);
    },
    'scim/internal_queries:getGroupRecord': async (raw) => {
      const args = org.extend({ teamId: z.string() }).parse(raw);
      return getGroupRecord(sql, args.organizationId, args.teamId);
    },
    'scim/internal_queries:findGroupRecordByDisplayName': async (raw) => {
      const args = org.extend({ displayName: z.string() }).parse(raw);
      return findGroupRecordByDisplayName(
        sql,
        args.organizationId,
        args.displayName,
      );
    },
    'scim/internal_queries:listGroupRecords': async (raw) => {
      const { organizationId, ...pageArgs } = page.parse(raw);
      return listGroupRecords(sql, organizationId, pageArgs);
    },
    'scim/internal_mutations:provisionUser': async (raw) => {
      const args = org
        .extend({
          defaultRole: z.string(),
          email: z.string(),
          name: z.string(),
          externalId: z.string().optional(),
          active: z.boolean(),
        })
        .parse(raw);
      return provisionUser(sql, args);
    },
    'scim/internal_mutations:patchUser': async (raw) => {
      const args = org
        .extend({
          userId: z.string(),
          defaultRole: z.string(),
          active: z.boolean().optional(),
          name: z.string().optional(),
          email: z.string().optional(),
          externalId: z.string().optional(),
        })
        .parse(raw);
      return patchUser(sql, args);
    },
    'scim/internal_mutations:deprovisionUser': async (raw) => {
      const args = org.extend({ userId: z.string() }).parse(raw);
      return deprovisionUser(sql, args.organizationId, args.userId);
    },
    'scim/internal_mutations:provisionGroup': async (raw) => {
      const args = org
        .extend({
          displayName: z.string(),
          externalId: z.string().optional(),
          memberIds: z.array(z.string()),
        })
        .parse(raw);
      return provisionGroup(sql, args);
    },
    'scim/internal_mutations:replaceGroup': async (raw) => {
      const args = org
        .extend({
          teamId: z.string(),
          displayName: z.string(),
          memberIds: z.array(z.string()),
          externalId: z.string().optional(),
        })
        .parse(raw);
      return replaceGroup(sql, args);
    },
    'scim/internal_mutations:patchGroup': async (raw) => {
      const args = org
        .extend({
          teamId: z.string(),
          displayName: z.string().optional(),
          addMembers: z.array(z.string()),
          removeMembers: z.array(z.string()),
          replaceMembers: z.array(z.string()).optional(),
        })
        .parse(raw);
      return patchGroup(sql, args);
    },
    'scim/internal_mutations:deleteGroup': async (raw) => {
      const args = org.extend({ teamId: z.string() }).parse(raw);
      return deleteGroup(sql, args.organizationId, args.teamId);
    },
  };
}
