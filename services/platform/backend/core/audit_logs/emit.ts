import type { MutationCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { AuditContext, AuditLogCategory } from './types';

interface EmitAuditSuccessOptions {
  auditCtx: AuditContext;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Emit a `success` audit row from inside a user-facing (RLS-wrapped) mutation.
 *
 * `createAuditLog` opens every write by upserting the per-org
 * `auditLogChainGenesis` sentinel, and that table is deny-all for ALL roles
 * under `mutationWithRLS` (see `lib/rls/helpers/rls_rules.ts`). So calling
 * `AuditLogHelpers.logSuccess(ctx, …)` with the RLS-wrapped ctx fails the
 * sentinel's RLS insert/modify check and aborts the entire mutation with
 * `insert access not allowed` — regardless of the actor's role. (The
 * `auditLogs` row insert is additionally gated on the audit-write capability,
 * which `member` lacks per `access_control.ts`, but the genesis denial bites
 * first and for everyone.) The actor is being *audited*, not granted
 * audit-table write access, so the write must not run on their RLS ctx (#1972).
 *
 * Routing through the internal `createAuditLog` mutation runs the write on a
 * raw (non-RLS) ctx that bypasses the matrix, atomically within the parent
 * mutation's transaction. This mirrors the config surfaces'
 * `emitPromptAudit`, the established pattern for the same need.
 */
export async function emitAuditSuccess(
  ctx: MutationCtx,
  options: EmitAuditSuccessOptions,
): Promise<void> {
  const { auditCtx } = options;
  await ctx.runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: auditCtx.organizationId,
    actorId: auditCtx.actor.id,
    actorEmail: auditCtx.actor.email,
    actorRole: auditCtx.actor.role,
    actorType: auditCtx.actor.type,
    sessionId: auditCtx.sessionId,
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
    requestId: auditCtx.requestId,
    action: options.action,
    category: options.category,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    resourceName: options.resourceName,
    previousState: options.previousState,
    newState: options.newState,
    status: 'success',
    metadata: options.metadata,
  });
}
