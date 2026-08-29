/**
 * Admin/compliance verticals over the 0.5 backend: the AUDIT LOGS surface
 * (list/errors/summary/detail, chain integrity, export), per-org BRANDING
 * (file-config family), and the ENTERPRISE SSO + SCIM admin card. Servers
 * for all three landed in earlier increments — this file is the adapter
 * rows. Response types are DERIVED from the 0.4 function signatures.
 */

import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { BackendApiError, backendFetch } from './api-client';
import type {
  ActionQueryAdapter,
  AdapterContext,
  PaginatedAdapter,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

type AuditListResult = FunctionReturnType<
  typeof api.audit_logs.queries.listAuditLogs
>;
type ActivitySummaryResult = FunctionReturnType<
  typeof api.audit_logs.queries.getActivitySummary
>;
type IntegrityStatusResult = FunctionReturnType<
  typeof api.audit_logs.verify_integrity.getIntegrityStatus
>;
type VerifyIntegrityResult = FunctionReturnType<
  typeof api.audit_logs.verify_integrity.verifyIntegrity
>;
type RequestExportResult = FunctionReturnType<
  typeof api.audit_logs.actions.requestExport
>;
type BrandingReadResult = FunctionReturnType<
  typeof api.branding.file_actions.readBranding
>;
type SaveImageResult = FunctionReturnType<
  typeof api.branding.file_actions.saveImage
>;
type SsoConnectionViewResult = FunctionReturnType<
  typeof api.enterprise_sso.config.queries.get
>;
type TestSsoResult = FunctionReturnType<
  typeof api.enterprise_sso.config.actions.testConnection
>;
type ParseIdpMetadataResult = FunctionReturnType<
  typeof api.enterprise_sso.config.actions.parseIdpMetadata
>;
type RegenerateScimResult = FunctionReturnType<
  typeof api.scim.mutations.regenerateToken
>;

/** One audit row on the pg wire (superset of the 0.4 doc; `id` not `_id`). */
type AuditLogWire = Record<string, unknown> & { id: string };

interface AuditPage {
  items: AuditLogWire[];
  nextCursor: { ts: number; id: string } | null;
}

function withConvexId(row: AuditLogWire): Record<string, unknown> {
  return { ...row, _id: row.id };
}

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

/** The 0.4 audit filter object → the pg listing's query params. */
function auditFilterQs(filter: unknown): string {
  if (filter === null || typeof filter !== 'object') return '';
  let qs = '';
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    qs += `&${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
  }
  return qs;
}

export const adminReadAdapters: Record<string, ReadAdapter> = {
  'audit_logs/queries:listAuditLogs': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const filterQs = auditFilterQs(args.filter);
    return {
      queryKey: backendKey(orgId, 'audit_log', 'list', String(limit), filterQs),
      queryFn: () =>
        backendFetch<AuditPage>(`/audit-logs?limit=${limit}${filterQs}`, {
          orgId,
        }).then(
          (body): AuditListResult =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg rows are the 0.4 doc superset; ids bridged
            ({
              logs: body.items.map(withConvexId),
              ...(body.nextCursor !== null
                ? { nextCursor: `${body.nextCursor.ts}|${body.nextCursor.id}` }
                : {}),
            }) as AuditListResult,
        ),
    };
  },
  'audit_logs/queries:getAuditLogById': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const logId = args.logId;
    if (orgId === undefined || typeof logId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'audit_log', 'detail', logId),
      queryFn: () =>
        backendFetch<{ log: AuditLogWire }>(
          `/audit-logs/${encodeURIComponent(logId)}`,
          { orgId },
        ).then(
          (body) => withConvexId(body.log),
          (error: unknown) => {
            // The 0.4 read answers null for a missing/foreign row.
            if (error instanceof BackendApiError && error.status === 404) {
              return null;
            }
            throw error;
          },
        ),
    };
  },
  'audit_logs/queries:getActivitySummary': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const periodDays =
      typeof args.periodDays === 'number' ? args.periodDays : 7;
    return {
      queryKey: backendKey(orgId, 'audit_log', 'summary', String(periodDays)),
      queryFn: () =>
        backendFetch<ActivitySummaryResult>(
          `/audit-logs/summary?periodDays=${periodDays}`,
          { orgId },
        ),
    };
  },
  'audit_logs/verify_integrity:getIntegrityStatus': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'audit_log', 'integrity-status'),
      queryFn: () =>
        backendFetch<{ status: IntegrityStatusResult }>(
          '/audit-logs/integrity/status',
          { orgId },
        ).then((body) => body.status),
    };
  },
  'audit_logs/verify_integrity:verifyIntegrity': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'audit_log', 'integrity-verify'),
      queryFn: () =>
        backendFetch<VerifyIntegrityResult>('/audit-logs/integrity/verify', {
          orgId,
          body: {
            ...(typeof args.maxEntries === 'number'
              ? { maxEntries: args.maxEntries }
              : {}),
            ...(typeof args.fromTimestamp === 'number'
              ? { fromTimestamp: args.fromTimestamp }
              : {}),
            ...(typeof args.afterId === 'string'
              ? { afterId: args.afterId }
              : {}),
            ...(typeof args.previousExpectedHash === 'string'
              ? { previousExpectedHash: args.previousExpectedHash }
              : {}),
          },
        }),
    };
  },
  'enterprise_sso/config/queries:get': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'sso_connection', 'view'),
      queryFn: () =>
        backendFetch<SsoConnectionViewResult>('/sso/config', { orgId }),
    };
  },
};

export const adminActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'branding/file_actions:readBranding': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    return () =>
      backendFetch<BrandingReadResult>(
        '/branding',
        orgId !== undefined ? { orgId } : {},
      );
  },
};

export const adminPaginatedAdapters: Record<string, PaginatedAdapter> = {
  'audit_logs/queries:listAuditLogsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const category = typeof args.category === 'string' ? args.category : '';
    const resourceType =
      typeof args.resourceType === 'string' ? args.resourceType : '';
    const qs =
      (category !== '' ? `&category=${encodeURIComponent(category)}` : '') +
      (resourceType !== ''
        ? `&resourceType=${encodeURIComponent(resourceType)}`
        : '');
    return {
      queryKey: backendKey(orgId, 'audit_log', 'page', category, resourceType),
      fetchPage: (cursor, numItems) =>
        backendFetch<AuditPage>(
          `/audit-logs?limit=${numItems}${qs}${auditCursorQs(cursor)}`,
          { orgId },
        ).then(auditPageEnvelope),
    };
  },
  'audit_logs/queries:listErrorLogsPaginated': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const category = typeof args.category === 'string' ? args.category : '';
    const qs =
      category !== '' ? `&category=${encodeURIComponent(category)}` : '';
    return {
      queryKey: backendKey(orgId, 'audit_log', 'errors-page', category),
      fetchPage: (cursor, numItems) =>
        backendFetch<AuditPage>(
          `/audit-logs/errors?limit=${numItems}${qs}${auditCursorQs(cursor)}`,
          { orgId },
        ).then(auditPageEnvelope),
    };
  },
};

function auditCursorQs(cursor: string | null): string {
  if (cursor === null) return '';
  const [ts, id] = cursor.split('|');
  if (ts === undefined || id === undefined || id === '') return '';
  return `&cursorTs=${encodeURIComponent(ts)}&cursorId=${encodeURIComponent(id)}`;
}

function auditPageEnvelope(body: AuditPage): {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
} {
  return {
    page: body.items.map(withConvexId),
    isDone: body.nextCursor === null,
    continueCursor:
      body.nextCursor === null
        ? ''
        : `${body.nextCursor.ts}|${body.nextCursor.id}`,
  };
}

function invalidateBranding(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  // Branding rides `useActionQuery` keys owned by the caller (configKeys),
  // so the write invalidates the whole config-key family instead of a
  // backend-prefixed key.
  void client.invalidateQueries({ queryKey: ['config', 'branding'] });
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'branding'),
  });
}

function invalidateSso(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'sso_connection'),
  });
}

/** Strip `organizationId` (the org rides the query string on the pg wire). */
function bodyOf(args: Record<string, unknown>): Record<string, unknown> {
  const { organizationId, ...rest } = args;
  void organizationId;
  return rest;
}

export const adminWriteAdapters: Record<string, WriteAdapter> = {
  'audit_logs/actions:requestExport': {
    run: (args, ctx) =>
      backendFetch<RequestExportResult>('/audit-logs/export', {
        orgId: requireOrg(args, ctx),
        body: {
          format: args.format,
          ...(args.filter !== undefined ? { filter: args.filter } : {}),
        },
      }),
  },
  'branding/file_actions:saveBranding': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/branding/save', {
        orgId: requireOrg(args, ctx),
        body: args.config ?? {},
      }).then(() => null),
    invalidate: invalidateBranding,
  },
  'branding/file_actions:saveImage': {
    run: (args, ctx) =>
      backendFetch<SaveImageResult>('/branding/images', {
        orgId: requireOrg(args, ctx),
        body: {
          type: stringArg(args, 'type'),
          base64: stringArg(args, 'base64'),
          mimeType: stringArg(args, 'mimeType'),
        },
      }),
    invalidate: invalidateBranding,
  },
  'branding/file_actions:deleteImage': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/branding/images/${encodeURIComponent(stringArg(args, 'type'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateBranding,
  },
  'branding/file_actions:snapshotToHistory': {
    run: (args, ctx) =>
      backendFetch<{ snapshot: string | null }>('/branding/snapshot', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
  },
  'enterprise_sso/config/actions:upsertOidc': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sso/config/oidc', {
        orgId: requireOrg(args, ctx),
        method: 'PUT',
        body: bodyOf(args),
      }).then(() => null),
    invalidate: invalidateSso,
  },
  'enterprise_sso/config/actions:upsertSaml': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sso/config/saml', {
        orgId: requireOrg(args, ctx),
        method: 'PUT',
        body: bodyOf(args),
      }).then(() => null),
    invalidate: invalidateSso,
  },
  'enterprise_sso/config/actions:setProvisioning': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sso/config/provisioning', {
        orgId: requireOrg(args, ctx),
        method: 'PUT',
        body: bodyOf(args),
      }).then(() => null),
    invalidate: invalidateSso,
  },
  'enterprise_sso/config/actions:testConnection': {
    run: (args, ctx) =>
      backendFetch<TestSsoResult>('/sso/config/test', {
        orgId: requireOrg(args, ctx),
        body: bodyOf(args),
      }),
  },
  'enterprise_sso/config/actions:parseIdpMetadata': {
    run: (args, ctx) =>
      backendFetch<ParseIdpMetadataResult>('/sso/config/parse-idp-metadata', {
        orgId: requireOrg(args, ctx),
        body: bodyOf(args),
      }),
  },
  'enterprise_sso/config/actions:revealOidcClientId': {
    run: (args, ctx) =>
      backendFetch<{ clientId: string | null }>('/sso/config/client-id', {
        orgId: requireOrg(args, ctx),
      }).then((body) => body.clientId),
  },
  'enterprise_sso/config/actions:disableSso': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sso/config/enabled', {
        orgId: requireOrg(args, ctx),
        body: { enabled: false },
      }).then(() => null),
    invalidate: invalidateSso,
  },
  'enterprise_sso/config/actions:remove': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/sso/config', {
        orgId: requireOrg(args, ctx),
        method: 'DELETE',
      }).then(() => null),
    invalidate: invalidateSso,
  },
  'scim/mutations:regenerateToken': {
    run: (args, ctx) =>
      backendFetch<RegenerateScimResult>('/scim/regenerate-token', {
        orgId: requireOrg(args, ctx),
        body: {},
      }),
    invalidate: invalidateSso,
  },
  'scim/mutations:disable': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>('/scim/disable', {
        orgId: requireOrg(args, ctx),
        body: {},
      }).then(() => null),
    invalidate: invalidateSso,
  },
};
