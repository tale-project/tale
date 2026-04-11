/**
 * Audit log export action.
 *
 * Generates a CSV or JSON file of audit logs matching the given filters,
 * stores the file in Convex file storage, and returns a download URL.
 *
 * Admin-only access.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export const exportAuditLogs = internalAction({
  args: {
    organizationId: v.string(),
    format: v.union(v.literal('csv'), v.literal('json')),
    filter: v.optional(
      v.object({
        category: v.optional(v.string()),
        actorId: v.optional(v.string()),
        resourceType: v.optional(v.string()),
        status: v.optional(v.string()),
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        search: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    storageId: v.string(),
    fileName: v.string(),
  }),
  handler: async (ctx, args) => {
    const logs = await ctx.runQuery(
      internal.audit_logs.internal_queries.listLogsForExport,
      {
        organizationId: args.organizationId,
        filter: args.filter,
      },
    );

    let content: string;
    let fileName: string;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (args.format === 'json') {
      content = JSON.stringify(logs, null, 2);
      fileName = `audit-logs-${timestamp}.json`;
    } else {
      const headers = [
        'timestamp',
        'action',
        'category',
        'actorEmail',
        'actorId',
        'actorType',
        'actorRole',
        'resourceType',
        'resourceId',
        'resourceName',
        'status',
        'errorMessage',
      ];

      const rows = logs.map((log: Record<string, unknown>) =>
        headers
          .map((h) => {
            const val = log[h];
            if (val == null) return '';
            if (h === 'timestamp' && typeof val === 'number') {
              return new Date(val).toISOString();
            }
            const str =
              typeof val === 'string'
                ? val
                : typeof val === 'number' || typeof val === 'boolean'
                  ? String(val)
                  : JSON.stringify(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
          })
          .join(','),
      );

      content = [headers.join(','), ...rows].join('\n');
      fileName = `audit-logs-${timestamp}.csv`;
    }

    const blob = new Blob([content], {
      type: args.format === 'json' ? 'application/json' : 'text/csv',
    });
    const storageId = await ctx.storage.store(blob);

    return { storageId: String(storageId), fileName };
  },
});
