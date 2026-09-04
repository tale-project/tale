/**
 * `sandbox` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../sandbox.ts` are what
 * actually serve them.
 */

export interface SandboxContract {
  'sandbox/session_queries_public:getAgentNodeSandboxOp': {
    kind: 'query';
    args: { organizationId: string; runId: string };
    returns: null | {
      lastEventAt?: number;
      finishedAt?: number;
      startedAt: number;
      visionModelRef?: string;
      modelRef?: string;
      liveTimeline?: Array<{
        text?: string;
        input?: unknown;
        output?: unknown;
        state?: string;
        toolCallId?: string;
        errorText?: string;
        type: string;
      }>;
      progressText?: string;
      execId: string;
      status: 'running' | 'failed' | 'cancelled' | 'completed';
    };
  };
  'sandbox/session_queries_public:getExternalTurnMetrics': {
    kind: 'query';
    args: { periodDays?: number; organizationId: string };
    returns: null | {
      periodDays: number;
      capped: boolean;
      total: number;
      completed: number;
      failed: number;
      cancelled: number;
      timeout: number;
      recovered: number;
      successRate: null | number;
      timeoutRate: null | number;
      durationP50Ms: number;
      durationP95Ms: number;
      spentCents: number;
      byHarness: Array<
        { harness: string } & {
          total: number;
          completed: number;
          failed: number;
          timeout: number;
        } & { successRate: null | number }
      >;
    };
  };
  'sandbox/session_queries_public:getHarnessHealth': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      harness: string;
      recentTotal: number;
      recentFailures: number;
      degraded: boolean;
    }>;
  };
  'sandbox/session_queries_public:getSandboxQuotaUsage': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | Array<{
      budget: 'workflow' | 'project' | 'render';
      used: number;
      cap: number;
      atLimit: boolean;
      nearLimit: boolean;
    }>;
  };
  'sandbox/session_queries_public:listSandboxesForOrg': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | Array<{
      sessionId: string;
      ownerType: string;
      ownerId: string;
      createdBy: string;
      ownerName: null | string;
      ownerEmail: null | string;
      agentKind: null | string;
      status: 'active' | 'creating' | 'degraded' | 'stopped';
      pinned: boolean;
      createdAt: number;
      expiresAt: number;
      lastActivityAt: null | number;
      busy: boolean;
      totalSpentCents: number;
      currentOp: null | {
        threadId?: string;
        execId: string;
        status: string;
        continuationCount?: number;
        spentCents?: number;
        pausedReason?: string;
        progressText?: string;
        startedAt: number;
        heartbeatAt?: number;
      };
    }>;
  };
}
