/**
 * App contracts for sandbox management and agent execution reads. The
 * adapters in `../settings.ts` bind these names to authenticated HTTP routes.
 */

import type { WaitingAgentRunCounts } from '@/backend/domains/sandbox/sessions';
import type { SandboxDeploymentLimits } from '@/lib/shared/schemas/sandbox-capacity';

export interface SandboxContract {
  'sandbox/session_queries_public:getSandboxDeploymentLimits': {
    kind: 'query';
    args: { organizationId: string };
    returns: SandboxDeploymentLimits;
  };
  'sandbox/session_queries_public:getSandboxCapacity': {
    kind: 'query';
    args: { organizationId: string };
    returns: SandboxCapacity;
  };
  'sandbox/session_queries_public:getAgentNodeSandboxOp': {
    kind: 'query';
    args: { organizationId: string; runId: string; nodeId?: string };
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
  /** The organization's workspaces, and how many agent runs wait for room
   * (every one counted, by reason): the demand an admin weighs raising the
   * limit of agent workers against. */
  'sandbox/session_queries_public:listSandboxesForOrg': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | {
      sessions: SandboxSessionListRow[];
      waitingRuns: WaitingAgentRunCounts;
    };
  };
}

/** One workspace on the Sandboxes page. */
interface SandboxSessionListRow {
  sessionId: string;
  ownerType: string;
  ownerId: string;
  ownerLabel?: string | null;
  createdBy: string;
  ownerName: null | string;
  ownerEmail: null | string;
  agentKind: null | string;
  /** Which of its agent's workers a project agent's workspace is: the
   * agent's own (`agent`) or one a member's runs work in (`member`), and
   * its number within that family. */
  worker?: { number: number; scope: 'agent' | 'member' };
  status: 'active' | 'creating' | 'degraded' | 'stopped';
  pinned: boolean;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: null | number;
  busy: boolean;
  totalSpentCents: number;
  /** The op the row leads with: a running one, else the latest. */
  currentOp: null | SandboxOpView;
  /** Every op still running in this workspace, oldest first: a worker
   * runs one task at a time, but a steered turn's predecessor or a turn
   * started during a rolling deploy can run beside it. */
  runningOps: SandboxOpView[];
  /** When the workspace is deleted for being unused, if it stays
   * unused; null when nothing will delete it. */
  deletesAt?: number | null;
  /** An administrator's Destroy still under way (`pending`), or one
   * whose every attempt failed (`failed`); null when none is. */
  destroyState?: 'pending' | 'failed' | null;
}

/** One sandbox operation (an agent turn) as the settings page sees it. */
interface SandboxOpView {
  kind?: 'task-agent' | 'workflow-agent';
  taskId?: string;
  /** The task a project agent's op works, as a reader knows it: its key
   * (`KEY-12`, when its project has one) and title. Absent for a task gone
   * since. */
  task?: { id: string; projectId: string; key?: string; title: string };
  workflowRunId?: string;
  threadId?: string;
  execId: string;
  status: string;
  continuationCount?: number;
  spentCents?: number;
  pausedReason?: string;
  progressText?: string;
  startedAt: number;
  heartbeatAt?: number;
}

export type SandboxCapacity =
  | { status: 'unavailable'; reason: 'not_configured' | 'unreachable' }
  | {
      status: 'available';
      observedAt: number;
      backend: 'docker' | 'kubernetes';
      scope: 'host' | 'namespace';
      sessions: {
        running: number;
        starting: number;
        limit: number;
        organizationRunning: number;
        organizationStarting: number;
        /** Deprecated compatibility field; never an organization quota. */
        organizationLimit: number;
      };
      resources: {
        cpu: { totalCores: number | null; usedCores: number | null };
        memory: { totalBytes: number | null; usedBytes: number | null };
      };
      runtimeSessions: Array<{
        sessionId: string;
        state: 'running' | 'starting' | 'stopped';
        /** Set when the session runs on one of the organization's devices. */
        deviceId?: string;
      }>;
      /** Where the organization's device-placed sessions live, also while
       * their device is offline. */
      placements?: Array<{ sessionId: string; deviceId: string }>;
    };
