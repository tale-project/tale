/**
 * `automations` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../automations.ts` are what
 * actually serve them.
 */

import type { QuestionSet } from '@/lib/shared/schemas/questions';

/** What a `waiting` run is parked on. `approval`, `ask` and `in_doubt`
 * wait on a person; the rest on the run itself. */
export type RunWaitingFor =
  | 'approval'
  | 'ask'
  | 'in_doubt'
  | 'agent'
  | 'room'
  | 'repeat';

/** Why and when a run last moved to another server: `shutdown` — its server
 * was being updated or restarted and handed it on; `lease_expired` — its
 * server stopped responding and another one took it over. */
export interface RunLastResume {
  reason: 'shutdown' | 'lease_expired';
  at: number;
}

/** How a person continues past a write that may already have happened. */
export type InDoubtResolution = 'retry' | 'skip' | 'fail';

/** The write a run waits on a person about: a connector call that may or
 * may not have reached its service when the run was interrupted. */
export interface RunInDoubt {
  attemptId: string;
  /** The node's path: its id at the top level, `<parent>[<item>:<pass>]/<id>`
   * inside a subautomation. */
  nodeId: string;
  itemIndex: number;
  pass: number;
  attempt: number;
  nodeType: string;
  /** The connector in words — its display name, or its slug. */
  connector: string;
  action: string;
  /** What the step was sending. */
  input: unknown;
  startedAt: number;
}

/** One subject-linked run as the task modal reads it. */
export interface AutomationRunForTask {
  detail?: string;
  runId: string;
  name: string;
  status: 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'cancelled';
  version: number;
}

export interface AutomationsContract {
  'automations/catalog:listNodeTypes': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<{
      hasEffect?: boolean;
      type: string;
      kind: 'connector' | 'core';
      description: string;
      allowedFields: string[];
      requiredFields: string[];
      outputKind: 'structured' | 'unstructured';
    }>;
  };
  'automations/human_asks:answerAsk': {
    kind: 'mutation';
    args: { organizationId: string; answer: string; askId: string };
    returns: null;
  };
  'automations/human_asks:getPendingAskForRun': {
    kind: 'query';
    args: { organizationId: string; runId: string };
    returns: null | {
      taskId?: string;
      createdAt: number;
      expiresAt: number;
      questions?: QuestionSet;
      askId: string;
      runId: string;
      nodeId: string;
      question: string;
    };
  };
  'automations/mutations:cancelRun': {
    kind: 'mutation';
    args: { organizationId: string; runId: string };
    returns: { cancelled: boolean };
  };
  'automations/mutations:resolveRunInDoubt': {
    kind: 'mutation';
    args: {
      organizationId: string;
      runId: string;
      attemptId: string;
      /** The attempt the choice is about (`RunInDoubt.attempt`): a write run
       * again keeps its `attemptId`, so a choice about an earlier attempt
       * is refused (409) instead of deciding a later one. */
      attempt: number;
      resolution: InDoubtResolution;
    };
    returns: null;
  };
  'automations/mutations:deleteAutomation': {
    kind: 'mutation';
    args: { organizationId: string; name: string };
    returns: { name: string; versions: number };
  };
  'automations/mutations:deleteTrigger': {
    kind: 'mutation';
    args: { organizationId: string; name: string };
    returns: null;
  };
  'automations/mutations:deployAutomation': {
    kind: 'mutation';
    args: { organizationId: string; name: string; version: number };
    returns: { name: string; version: number };
  };
  'automations/mutations:saveAutomation': {
    kind: 'mutation';
    args: {
      projectId?: string;
      message?: string;
      testsPassed?: boolean;
      taskContract?: unknown;
      settings?: unknown;
      presentation?: unknown;
      create?: boolean;
      organizationId: string;
      automation: unknown;
    };
    /** `warnings` are the problems the save let through — they never
     * refuse one (`lib/shared/schemas/automation-issues.ts` reads them). */
    returns: { name: string; version: number; warnings?: unknown[] };
  };
  'automations/mutations:setAutomationProjects': {
    kind: 'mutation';
    args: { organizationId: string; name: string; projectIds: string[] };
    returns: { bound: number; unbound: number };
  };
  'automations/mutations:setTrigger': {
    kind: 'mutation';
    args: {
      rotateToken?: boolean;
      organizationId: string;
      name: string;
      trigger: {
        cron?: string;
        event?: string;
        timezone?: string;
        enabled?: boolean;
        kind: 'schedule' | 'webhook' | 'event';
      };
    };
    /** `revoked` names a live webhook URL this bind replaced with another
     * kind — it stopped answering the moment the bind committed. */
    returns: { token?: string; revoked?: 'webhook' };
  };
  'automations/mutations:startRun': {
    kind: 'mutation';
    args: {
      version?: number;
      projectId?: string;
      mode?: 'mock' | 'live';
      input?: unknown;
      organizationId: string;
      name: string;
    };
    returns: { runId: string; version: number };
  };
  'automations/queries:getAutomation': {
    kind: 'query';
    args: { version?: number; organizationId: string; name: string };
    returns: null | {
      createdBy: string;
      createdAt: number;
      deployedUnpinnedAgentNodes?: string[];
      deployedVersion?: number;
      presentation?: unknown;
      settings?: unknown;
      taskContract?: unknown;
      testsPassed?: boolean;
      message?: string;
      name: string;
      version: number;
      document: unknown;
    };
  };
  'automations/queries:getLiveRunForTask': {
    kind: 'query';
    args: { organizationId: string; projectId: string; taskId: string };
    returns: null | AutomationRunForTask;
  };
  /** The task's most recent subject-linked run in ANY state — the property
   * panel's Run row, which keeps a finished run's details reachable. */
  'automations/queries:getLatestRunForTask': {
    kind: 'query';
    args: { organizationId: string; projectId: string; taskId: string };
    returns: null | AutomationRunForTask;
  };
  'automations/queries:getOrgAutomationMetrics': {
    kind: 'query';
    args: {
      mode?: 'mock' | 'live';
      organizationId: string;
      periodDays: 7 | 30 | 90;
    };
    returns: {
      summary: {
        total: number;
        success: number;
        failed: number;
        running: number;
        waiting: number;
        queued: number;
        cancelled: number;
        successRate: number;
        avgDurationSeconds: number;
        lastRun: null | number;
        capped: boolean;
      };
      previousSummary: {
        total: number;
        success: number;
        failed: number;
        successRate: number;
        avgDurationSeconds: number;
      };
      series: Array<{
        dateKey: string;
        success: number;
        failed: number;
        running: number;
      }>;
      topAutomations: Array<{
        name: string;
        total: number;
        success: number;
        failed: number;
        successRate: number;
        avgDurationSeconds: number;
        lastRun: null | number;
      }>;
    };
  };
  'automations/queries:getRun': {
    kind: 'query';
    args: { organizationId: string; runId: string };
    returns: null | {
      projectId?: string;
      finishedAt?: number;
      startedAt: number;
      detail?: string;
      effects?: unknown;
      trace?: unknown;
      checkpoints?: unknown;
      output?: unknown;
      agentAutoRetryMax: number;
      id: string;
      name: string;
      version: number;
      status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'success'
        | 'failed'
        | 'cancelled';
      mode: 'mock' | 'live';
      startedBy: string;
      /** Which kind of trigger started a `trigger:<id>` run. */
      startedVia?: 'schedule' | 'webhook' | 'event';
      /** What a `waiting` run is parked on. */
      waitingFor?: RunWaitingFor;
      /** How often the run moved to another server; absent while never. */
      resumeCount?: number;
      /** Why and when it last moved to another server. */
      lastResume?: RunLastResume;
      /** A running run waiting for a server to take it over. */
      stalled?: boolean;
      input: unknown;
    };
  };
  'automations/queries:getRunInDoubt': {
    kind: 'query';
    args: { organizationId: string; runId: string };
    returns: null | RunInDoubt;
  };
  'automations/queries:listAutomationProjects': {
    kind: 'query';
    args: { organizationId: string; name: string };
    returns: string[];
  };
  'automations/queries:listAutomations': {
    kind: 'query';
    args: {
      projectId?: string;
      includeProjectBound?: boolean;
      organizationId: string;
    };
    returns: Array<{
      presentation?: unknown;
      settings?: unknown;
      taskContract?: unknown;
      deployedVersion?: number;
      name: string;
      latest: number;
      projectIds: string[];
    }>;
  };
  'automations/queries:listRuns': {
    kind: 'query';
    args: {
      name?: string;
      projectId?: string;
      limit?: number;
      organizationId: string;
    };
    returns: Array<{
      finishedAt?: number;
      startedAt: number;
      detail?: string;
      id: string;
      name: string;
      version: number;
      status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'success'
        | 'failed'
        | 'cancelled';
      mode: 'mock' | 'live';
      startedBy: string;
      /** Which kind of trigger started a `trigger:<id>` run. */
      startedVia?: 'schedule' | 'webhook' | 'event';
      /** What a `waiting` run is parked on. */
      waitingFor?: RunWaitingFor;
      /** How often the run moved to another server; absent while never. */
      resumeCount?: number;
      /** Why and when it last moved to another server. */
      lastResume?: RunLastResume;
      /** A running run waiting for a server to take it over. */
      stalled?: boolean;
    }>;
  };
  'automations/queries:listTriggers': {
    kind: 'query';
    args: { name?: string; organizationId: string };
    returns: Array<{
      id?: string;
      /** The last time this binding started a run — `lastRunId` names it. */
      lastFiredAt?: number;
      lastRunId?: string | null;
      /** The last time it came due and started nothing, and why — or, for
       * `paused_after_failures`, when the schedule paused itself. */
      lastSkippedAt?: number | null;
      lastSkipReason?:
        | 'not_deployed'
        | 'unusable_cron'
        | 'start_refused'
        | 'paused_after_failures'
        | null;
      /** Permanent failures in a row among the runs it started since its
       * last save; the last of them is `lastFailedAt` / `lastFailureCode` /
       * `lastFailedRunId`. */
      consecutiveFailures?: number;
      lastFailedAt?: number | null;
      lastFailureCode?: string | null;
      lastFailedRunId?: string | null;
      hasToken: boolean;
      enabled: boolean;
      event?: string;
      timezone?: string;
      cron?: string;
      name: string;
      kind: 'schedule' | 'webhook' | 'event' | 'api-key';
    }>;
  };
  'automations/queries:listVersions': {
    kind: 'query';
    args: { organizationId: string; name: string };
    returns: Array<{
      createdBy: string;
      createdAt: number;
      testsPassed?: boolean;
      message?: string;
      version: number;
    }>;
  };
  'automations/serving_preview:previewUnpinnedAgentServing': {
    kind: 'action';
    args: { organizationId: string; harness: string; model: string };
    returns:
      | {
          ok: true;
          providerSlug: string;
          modelId: string;
          lane: 'gateway' | 'subscription';
          reason?: undefined;
        }
      | {
          ok: false;
          reason: string;
          providerSlug?: undefined;
          modelId?: undefined;
          lane?: undefined;
        };
  };
  'automations/upload_action:uploadAutomation': {
    kind: 'action';
    args: {
      files?: Array<{ name: string; content: string }>;
      projectId?: string;
      storageId?: string;
      overwriteSkills?: string[];
      organizationId: string;
    };
    returns:
      | {
          ok: true;
          name: string;
          version: number;
          warnings: string[];
          skills: Array<{
            slug: string;
            action: 'created' | 'replaced' | 'unchanged';
          }>;
        }
      | { ok: false; status: 'needs_confirm'; skillConflicts: string[] };
  };
  'automations/upload_mutations:generateAutomationUploadUrl': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: string;
  };
  'automations/upload_mutations:recordAutomationUploadIntent': {
    kind: 'mutation';
    args: { organizationId: string; storageId: string };
    returns: null;
  };
}
