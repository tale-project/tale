/**
 * `automations` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../automations.ts` are what
 * actually serve them.
 */

import type { QuestionSet } from '@/lib/shared/schemas/questions';

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
    returns: { name: string; version: number };
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
    returns: { token?: string };
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
    returns: null | {
      detail?: string;
      runId: string;
      name: string;
      status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'success'
        | 'failed'
        | 'cancelled';
      version: number;
    };
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
      input: unknown;
    };
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
    }>;
  };
  'automations/queries:listTriggers': {
    kind: 'query';
    args: { name?: string; organizationId: string };
    returns: Array<{
      lastFiredAt?: number;
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
