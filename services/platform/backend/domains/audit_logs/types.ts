/**
 * Audit-log value vocabulary — ported from `convex/audit_logs/schema.ts`
 * (the Convex validators die with the component; the string unions are the
 * durable contract). The legacy `integration` category spelling is accepted
 * on READ paths only (pre-rename rows are immutable hash-chain history) and
 * never written by 0.5 code.
 */

export const AUDIT_LOG_ACTOR_TYPES = [
  'user',
  'system',
  'api',
  'workflow',
] as const;

export const AUDIT_LOG_CATEGORIES = [
  'auth',
  'member',
  'data',
  'connector',
  'integration',
  'workflow',
  'security',
  'admin',
  'ai',
  'skill',
  'agent',
] as const;

export const AUDIT_LOG_STATUSES = ['success', 'failure', 'denied'] as const;

export type AuditLogActorType = (typeof AUDIT_LOG_ACTOR_TYPES)[number];
export type AuditLogCategory = (typeof AUDIT_LOG_CATEGORIES)[number];
export type AuditLogStatus = (typeof AUDIT_LOG_STATUSES)[number];

export interface CreateAuditLogArgs {
  organizationId: string;
  actorId: string;
  actorEmail?: string;
  actorRole?: string;
  actorType: AuditLogActorType;
  action: string;
  category: AuditLogCategory;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  changedFields?: string[];
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  /** Peppered hash of `actorEmail` — mutually exclusive with the plaintext. */
  actorEmailHash?: string;
  /** Peppered hash of a coarse prefix of `ipAddress` — same contract. */
  actorIpHash?: string;
  status: AuditLogStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/** Request-scoped actor bundle threaded through domain writers. */
export interface AuditContext {
  organizationId: string;
  actor: {
    id: string;
    email?: string;
    role?: string;
    type: AuditLogActorType;
  };
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/** One persisted audit row as read back from `app.audit_logs`. */
export interface AuditLogRow {
  id: string;
  organizationId: string;
  actorId: string;
  actorEmail: string | null;
  actorEmailHash: string | null;
  actorRole: string | null;
  actorType: string;
  action: string;
  category: string;
  resourceType: string;
  resourceId: string | null;
  resourceName: string | null;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  changedFields: string[] | null;
  sessionId: string | null;
  ipAddress: string | null;
  actorIpHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  timestamp: number;
  status: string;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  integrityHash: string;
  previousHash: string | null;
  piiScrubbed: boolean | null;
}
