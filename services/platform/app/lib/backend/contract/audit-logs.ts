/**
 * `audit_logs` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../audit_logs.ts` are what
 * actually serve them.
 */

export interface AuditLogsContract {
  'audit_logs/actions:requestExport': {
    kind: 'action';
    args: {
      filter?: {
        search?: string;
        status?: string;
        resourceType?: string;
        category?: string;
        actorId?: string;
        startDate?: number;
        endDate?: number;
      };
      organizationId: string;
      format: 'json' | 'csv';
    };
    returns: { storageId: string; fileName: string; url: string };
  };
  'audit_logs/queries:getActivitySummary': {
    kind: 'query';
    args: { periodDays?: number; organizationId: string };
    returns: {
      totalActions: number;
      successCount: number;
      failureCount: number;
      deniedCount: number;
      byCategory: Record<string, number>;
      byResourceType: Record<string, number>;
      topActors: Array<{ actorId: string; actorEmail?: string; count: number }>;
    };
  };
  'audit_logs/queries:getAuditLogById': {
    kind: 'query';
    args: { organizationId: string; logId: string };
    returns: null | {
      _id: string;
      _creationTime: number;
      metadata?: Record<string, unknown>;
      lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
      statusChangedAt?: number;
      sessionId?: string;
      resourceId?: string;
      actorEmail?: string;
      actorRole?: string;
      resourceName?: string;
      previousState?: Record<string, unknown>;
      newState?: Record<string, unknown>;
      changedFields?: string[];
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
      actorEmailHash?: string;
      actorIpHash?: string;
      errorMessage?: string;
      integrityHash?: string;
      previousHash?: string;
      chainSuccessor?: string;
      piiScrubbed?: boolean;
      piiScrubbedAt?: number;
      status: 'success' | 'failure' | 'denied';
      organizationId: string;
      resourceType: string;
      actorType: 'user' | 'system' | 'api' | 'workflow';
      category:
        | 'auth'
        | 'data'
        | 'workflow'
        | 'member'
        | 'connector'
        | 'integration'
        | 'security'
        | 'admin'
        | 'ai'
        | 'skill'
        | 'agent';
      actorId: string;
      action: string;
      timestamp: number;
    };
  };
  'audit_logs/queries:listAuditLogs': {
    kind: 'query';
    args: {
      filter?: {
        search?: string;
        status?: 'success' | 'failure' | 'denied';
        resourceType?: string;
        resourceId?: string;
        category?:
          | 'auth'
          | 'data'
          | 'workflow'
          | 'member'
          | 'connector'
          | 'integration'
          | 'security'
          | 'admin'
          | 'ai'
          | 'skill'
          | 'agent';
        actorId?: string;
        startDate?: number;
        endDate?: number;
      };
      cursor?: string;
      limit?: number;
      organizationId: string;
    };
    returns: {
      logs: Array<{
        metadata?: Record<string, unknown>;
        lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
        statusChangedAt?: number;
        sessionId?: string;
        resourceId?: string;
        actorEmail?: string;
        actorRole?: string;
        resourceName?: string;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
        changedFields?: string[];
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        actorEmailHash?: string;
        actorIpHash?: string;
        errorMessage?: string;
        integrityHash?: string;
        previousHash?: string;
        chainSuccessor?: string;
        piiScrubbed?: boolean;
        piiScrubbedAt?: number;
        status: 'success' | 'failure' | 'denied';
        organizationId: string;
        _creationTime: number;
        resourceType: string;
        actorType: 'user' | 'system' | 'api' | 'workflow';
        category:
          | 'auth'
          | 'data'
          | 'workflow'
          | 'member'
          | 'connector'
          | 'integration'
          | 'security'
          | 'admin'
          | 'ai'
          | 'skill'
          | 'agent';
        actorId: string;
        action: string;
        timestamp: number;
        _id: string;
      }>;
      nextCursor?: string;
    };
  };
  'audit_logs/queries:listAuditLogsPaginated': {
    kind: 'query';
    args: {
      resourceType?: string;
      category?: string;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        _id: string;
        _creationTime: number;
        metadata?: Record<string, unknown>;
        lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
        statusChangedAt?: number;
        sessionId?: string;
        resourceId?: string;
        actorEmail?: string;
        actorRole?: string;
        resourceName?: string;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
        changedFields?: string[];
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        actorEmailHash?: string;
        actorIpHash?: string;
        errorMessage?: string;
        integrityHash?: string;
        previousHash?: string;
        chainSuccessor?: string;
        piiScrubbed?: boolean;
        piiScrubbedAt?: number;
        status: 'success' | 'failure' | 'denied';
        organizationId: string;
        resourceType: string;
        actorType: 'user' | 'system' | 'api' | 'workflow';
        category:
          | 'auth'
          | 'data'
          | 'workflow'
          | 'member'
          | 'connector'
          | 'integration'
          | 'security'
          | 'admin'
          | 'ai'
          | 'skill'
          | 'agent';
        actorId: string;
        action: string;
        timestamp: number;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
  'audit_logs/queries:listErrorLogsPaginated': {
    kind: 'query';
    args: {
      category?: string;
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        _id: string;
        _creationTime: number;
        metadata?: Record<string, unknown>;
        lifecycleStatus?: 'active' | 'trashed' | 'expired' | 'deleted';
        statusChangedAt?: number;
        sessionId?: string;
        resourceId?: string;
        actorEmail?: string;
        actorRole?: string;
        resourceName?: string;
        previousState?: Record<string, unknown>;
        newState?: Record<string, unknown>;
        changedFields?: string[];
        ipAddress?: string;
        userAgent?: string;
        requestId?: string;
        actorEmailHash?: string;
        actorIpHash?: string;
        errorMessage?: string;
        integrityHash?: string;
        previousHash?: string;
        chainSuccessor?: string;
        piiScrubbed?: boolean;
        piiScrubbedAt?: number;
        status: 'success' | 'failure' | 'denied';
        organizationId: string;
        resourceType: string;
        actorType: 'user' | 'system' | 'api' | 'workflow';
        category:
          | 'auth'
          | 'data'
          | 'workflow'
          | 'member'
          | 'connector'
          | 'integration'
          | 'security'
          | 'admin'
          | 'ai'
          | 'skill'
          | 'agent';
        actorId: string;
        action: string;
        timestamp: number;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
  'audit_logs/verify_integrity:getIntegrityStatus': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | {
      lastVerifiedTimestamp: undefined | number;
      lastVerifiedId: undefined | string;
      headReached: boolean;
      updatedAt: number;
      lastAlertedFingerprint: undefined | string;
      lastAlertedAt: undefined | number;
      alertActive: boolean;
    };
  };
  'audit_logs/verify_integrity:verifyIntegrity': {
    kind: 'query';
    args: {
      previousExpectedHash?: string;
      maxEntries?: number;
      fromTimestamp?: number;
      afterId?: string;
      organizationId: string;
    };
    returns:
      | {
          valid: boolean;
          verifiedCount: number;
          checkpointsVerified: number;
          truncated: boolean;
          unsignedScrubCount: number;
          lastVerifiedTimestamp: undefined | number;
          lastVerifiedId: undefined | string;
          lastVerifiedHash: undefined | string;
          checkpointMismatch: { checkpointId: string; reason: string };
          firstBrokenAt?: undefined;
        }
      | {
          valid: boolean;
          verifiedCount: number;
          checkpointsVerified: number;
          truncated: boolean;
          unsignedScrubCount: number;
          lastVerifiedTimestamp: undefined | number;
          lastVerifiedId: undefined | string;
          lastVerifiedHash: undefined | string;
          firstBrokenAt: {
            logId: string;
            timestamp: number;
            expected: string;
            actual: string;
          };
          checkpointMismatch?: undefined;
        }
      | {
          valid: boolean;
          verifiedCount: number;
          checkpointsVerified: number;
          truncated: boolean;
          unsignedScrubCount: number;
          lastVerifiedTimestamp: undefined | number;
          lastVerifiedId: undefined | string;
          lastVerifiedHash: undefined | string;
          checkpointMismatch?: undefined;
          firstBrokenAt?: undefined;
        };
  };
}
