/**
 * `automations` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../automations.ts` are what
 * actually serve them.
 */

import type { TemplateAnswers } from '@tale/shared/schemas/automation-template';
import type {
  TriggerView,
  TriggerWrite,
} from '@tale/shared/schemas/automation-trigger';
import type { z } from 'zod';

import type { AutomationTemplateCard } from '@/backend/domains/automations/templates';
import type { LegacyRunQuarantine } from '@/lib/engine/api/dispatch';
import type { Issue } from '@/lib/engine/core/types';
export type { LegacyRunQuarantine } from '@/lib/engine/api/dispatch';
import type { RunDiff } from '@/lib/engine/core/record/compare';
import type {
  NodeRunDetail,
  NodeRunPage,
  RunRecordView,
} from '@/lib/engine/core/record/read';
import type {
  ReplayKind,
  ReplayPlan,
  ReplayVersionChoice,
} from '@/lib/engine/core/record/replay';
export type { RunDiff } from '@/lib/engine/core/record/compare';
export type {
  NodeRunDetail,
  NodeRunPage,
  RecordedStep,
  RecordedUnit,
  RunEventView,
  RunRecordView,
} from '@/lib/engine/core/record/read';
export type { ReplayKind, ReplayPlan } from '@/lib/engine/core/record/replay';

import type { RunBench } from '@/lib/engine/core/types';
import type {
  runTestsAnswerSchema,
  tryAnswerSchema,
  versionTestReportSchema,
} from '@/lib/shared/schemas/automation-tests';
import type {
  DeploymentHistory,
  VersionHistory,
} from '@/lib/shared/schemas/automation-versions';
import type { NodeTypeCatalog } from '@/lib/shared/schemas/node-type-catalog';
import type { QuestionSet } from '@/lib/shared/schemas/questions';

/** A write action of an automation, as its General tab lists it: whether a
 * step of the latest version makes it, and who allowed it to run without a
 * person. */
export interface AutomationApprovalAllowanceRow {
  /** `<connector>.<action>`. */
  type: string;
  used: boolean;
  /** What the organization's approval policy decides for it whatever the
   * allowance says; null when the allowance decides. */
  policy: 'requires' | 'allows' | null;
  allowance: {
    grantedBy: string;
    /** The granter's name or email; null for someone erased or gone. */
    grantedByName: string | null;
    grantedAt: number;
  } | null;
}

/** How a run was run again, and from which run. */
export interface RunReplayOf {
  /** Null once the run it replays was deleted. */
  runId: string | null;
  kind: ReplayKind;
  fromNode?: string;
}

/** What running a run again asks for. A type, not an interface: the
 * contract's arguments must read as plain records. */
export type ReplayRequestArgs = {
  kind: ReplayKind;
  from?: string;
  version?: ReplayVersionChoice;
  mode?: 'mock' | 'live';
  input?: unknown;
};

/** What a replay started. */
export interface ReplayStarted {
  runId: string;
  version: number;
  mode: 'mock' | 'live';
  kind: ReplayKind;
  reused: number;
  duplicate?: true;
}

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
  status:
    | 'queued'
    | 'running'
    | 'waiting'
    | 'quarantined'
    | 'success'
    | 'failed'
    | 'cancelled';
  legacyQuarantine?: LegacyRunQuarantine;
  version: number;
}

export interface AutomationsContract {
  'automations/catalog:listNodeTypes': {
    kind: 'action';
    args: { organizationId: string };
    returns: NodeTypeCatalog;
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
  'automations/mutations:replayRun': {
    kind: 'mutation';
    args: {
      organizationId: string;
      runId: string;
      /** A nonce: a repeat of the same click starts one replay. */
      requestId?: string;
    } & ReplayRequestArgs;
    returns: ReplayStarted;
  };
  'automations/mutations:requestLegacyRunStop': {
    kind: 'mutation';
    args: {
      organizationId: string;
      runId: string;
      expectedClaimEpoch: number;
      expectedObservedAt: number;
      action: 'stop';
      acknowledgeUnknownExternalEffects: true;
    };
    returns: {
      requested: true;
      status: 'quarantined';
      legacyQuarantine: LegacyRunQuarantine;
    };
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
    /** `expectedDeployedVersion` is the version the caller read as live
     * (`null`: nothing deployed); another one live refuses the deploy
     * (`AUTOMATION_DEPLOYMENT_STALE`, naming who put it live). */
    args: {
      organizationId: string;
      name: string;
      version: number;
      expectedDeployedVersion?: number | null;
    };
    /** `trigger` is what starts the automation now that this version runs:
     * whether it is on, its next start, and what this version would make
     * of what it sends (`TRIGGER_INPUT_MISMATCH`,
     * `TRIGGER_INPUT_NOT_TEMPLATED`); null when nothing starts it. */
    returns: {
      name: string;
      version: number;
      /** What was live before; null when nothing was. */
      previousVersion?: number | null;
      /** `rollback` put an older version back; `unchanged` changed nothing,
       * the version was live already. */
      kind?: 'deploy' | 'rollback' | 'unchanged';
      deploymentId?: string | null;
      trigger?: {
        kind: TriggerView['kind'];
        enabled: boolean;
        nextRunAt: number | null;
        warnings: Issue[];
      } | null;
    };
  };
  /** Bring an older version back as the newest: it passes the save's own
   * checks and runs its tests, then saves restored from that version —
   * or nothing (`unchanged`) when its content is the latest already. */
  'automations/mutations:restoreAutomationVersion': {
    kind: 'mutation';
    args: {
      organizationId: string;
      name: string;
      version: number;
      /** "Restore v{N}" when left out. */
      message?: string;
      /** The latest version the caller read; a version saved since refuses
       * the restore (`AUTOMATION_VERSION_STALE`). */
      baseVersion?: number;
    };
    returns: {
      name: string;
      version: number;
      restoredFrom: number;
      unchanged?: true;
      testsPassed?: boolean;
      warnings?: unknown[];
    };
  };
  /** Run the draft or a saved version once, in mock mode, with an input
   * and what stands in for some nodes; nothing is stored. Charged to the
   * organization's bench budget (429 when spent). */
  'automations/mutations:tryAutomation': {
    kind: 'mutation';
    args: {
      organizationId: string;
      name: string;
      /** The draft; or `version`, one of the two. */
      document?: unknown;
      version?: number;
      input?: unknown;
      bench?: RunBench;
    };
    returns: z.infer<typeof tryAnswerSchema>;
  };
  /** Run the tests of the draft or of a saved version by hand, all or those
   * named by their place. A saved version's whole suite is recorded as its
   * verdict, made by hand (`recorded`). */
  'automations/mutations:runAutomationTests': {
    kind: 'mutation';
    args: {
      organizationId: string;
      name: string;
      document?: unknown;
      version?: number;
      tests?: number[];
      detail?: boolean;
    };
    returns: z.infer<typeof runTestsAnswerSchema>;
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
      /** The version the draft started from; another one saved since
       * refuses the save (`AUTOMATION_VERSION_STALE`). */
      baseVersion?: number;
      /** The version the draft was built from, recorded without a check —
       * "save anyway" after a stale refusal. */
      basedOnVersion?: number;
      organizationId: string;
      automation: unknown;
    };
    /** `warnings` are the problems the save let through — they never
     * refuse one (`lib/shared/schemas/automation-issues.ts` reads them);
     * `changes`, what the version changed against the one before it. */
    returns: {
      name: string;
      version: number;
      warnings?: unknown[];
      changes?: VersionHistory['versions'][number]['changes'];
    };
  };
  'automations/mutations:setApprovalAllowances': {
    kind: 'mutation';
    /** The whole set of step types the automation may write without a
     * person — owner or admin only. */
    args: { organizationId: string; name: string; allowed: string[] };
    returns: { granted: string[]; withdrawn: string[] };
  };
  'automations/mutations:createAutomationFromTemplate': {
    kind: 'mutation';
    /** Create an automation from the starter `slug`, with the answers to
     * its questions; `locale` words the defaults the starter offers in the
     * creator's language. */
    args: {
      organizationId: string;
      slug: string;
      name: string;
      displayName: string;
      answers: TemplateAnswers;
      locale?: string;
      /** Set the starter's trigger on; off when left out. */
      enableTrigger?: boolean;
    };
    returns: {
      name: string;
      version: number;
      warnings?: unknown[];
      /** The starter's trigger as it was set: a webhook's token, minted
       * now and shown once. */
      trigger?: { token?: string; nextRunAt?: number | null };
    };
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
      /** The shared write contract: one strict shape per kind. */
      trigger: TriggerWrite;
    };
    /** `revoked` names a live webhook URL this bind replaced with another
     * kind — it stopped answering the moment the bind committed.
     * `nextRunAt` is a schedule's next start; `warnings` what the deployed
     * version would make of what the trigger sends. */
    returns: {
      token?: string;
      revoked?: 'webhook';
      nextRunAt?: number | null;
      warnings?: Issue[];
    };
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
      /** The newest saved version, so a reader of an older one knows. */
      latestVersion?: number;
      /** The door the shown version was saved through, its client, what it
       * was based on or restored from, and what it changed. */
      createdVia?: VersionHistory['versions'][number]['createdVia'];
      viaInferred?: boolean;
      clientName?: string | null;
      basedOnVersion?: number | null;
      restoredFromVersion?: number | null;
      changes?: VersionHistory['versions'][number]['changes'];
    };
  };
  /** A saved version's latest test check and the report it came from. */
  'automations/queries:getAutomationTestReport': {
    kind: 'query';
    args: { organizationId: string; name: string; version: number };
    returns: z.infer<typeof versionTestReportSchema>;
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
      /** Why a `failed` run failed, as a stable code (`Run.failureCode`). */
      failureCode?: string;
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
        | 'quarantined'
        | 'success'
        | 'failed'
        | 'cancelled';
      mode: 'mock' | 'live';
      startedBy: string;
      legacyQuarantine?: LegacyRunQuarantine;
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
      /** A run started by running another one again. */
      replayOf?: RunReplayOf;
      input: unknown;
    };
  };
  'automations/queries:getRunRecord': {
    kind: 'query';
    args: {
      organizationId: string;
      runId: string;
      /** A cursor an earlier read answered: only what changed since. */
      since?: number;
      travels?: boolean;
    };
    returns: RunRecordView | null;
  };
  'automations/queries:getRunNode': {
    kind: 'query';
    args: {
      organizationId: string;
      runId: string;
      node: string;
      item?: number;
      pass?: number;
    };
    returns: NodeRunDetail | null;
  };
  'automations/queries:getRunItems': {
    kind: 'query';
    args: {
      organizationId: string;
      runId: string;
      node: string;
      cursor?: string;
      limit?: number;
      status?: 'all' | 'failed';
    };
    returns: NodeRunPage | null;
  };
  'automations/queries:compareRuns': {
    kind: 'query';
    args: { organizationId: string; runId: string; otherRunId: string };
    returns: RunDiff | null;
  };
  'automations/queries:getReplayPlan': {
    kind: 'query';
    args: { organizationId: string; runId: string } & ReplayRequestArgs;
    returns: ReplayPlan | null;
  };
  'automations/queries:getRunInDoubt': {
    kind: 'query';
    args: { organizationId: string; runId: string };
    returns: null | RunInDoubt;
  };
  'automations/queries:listApprovalAllowances': {
    kind: 'query';
    args: { organizationId: string; name: string };
    returns: {
      actions: AutomationApprovalAllowanceRow[];
      /** Whether the reader may change them: an owner or an admin. */
      canGrant: boolean;
    };
  };
  'automations/queries:listAutomationTemplates': {
    kind: 'query';
    args: { organizationId: string };
    returns: { templates: AutomationTemplateCard[] };
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
  'automations/queries:listRunsPaginated': {
    kind: 'query';
    args: {
      organizationId: string;
      name: string;
      projectId?: string;
      /** Only runs in these statuses (any of them). */
      statuses?: string[];
      mode?: 'mock' | 'live';
      paginationOpts: { numItems: number; cursor: null | string };
    };
    returns: {
      page: Array<{
        id: string;
        name: string;
        version: number;
        status:
          | 'queued'
          | 'running'
          | 'waiting'
          | 'quarantined'
          | 'success'
          | 'failed'
          | 'cancelled';
        mode: 'mock' | 'live';
        startedBy: string;
        startedVia?: 'schedule' | 'webhook' | 'event';
        waitingFor?: RunWaitingFor;
        stalled?: boolean;
        detail?: string;
        /** Why a `failed` run failed, as a stable code. */
        failureCode?: string;
        startedAt: number;
        finishedAt?: number;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
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
      /** Why a `failed` run failed, as a stable code (`Run.failureCode`). */
      failureCode?: string;
      id: string;
      name: string;
      version: number;
      status:
        | 'queued'
        | 'running'
        | 'waiting'
        | 'quarantined'
        | 'success'
        | 'failed'
        | 'cancelled';
      mode: 'mock' | 'live';
      startedBy: string;
      legacyQuarantine?: LegacyRunQuarantine;
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
    /** The shared read shape: a schedule's rule or cron, its zone, catch-up
     * policy and next start; the fixed input; the fire ledger (the last run,
     * the last skip, why, and its detail) and the failure streak. Never the
     * webhook secret: `hasToken` says one exists. */
    returns: TriggerView[];
  };
  'automations/queries:listTriggerRuns': {
    kind: 'query';
    args: { name: string; limit?: number; organizationId: string };
    /** The runs the bound trigger started, newest first (runs of projects
     * the member cannot read left out), each with the webhook delivery lane
     * that started it while the delivery's ledger row lives: a delivery-id
     * `header` (its name) or the `body`; null for a schedule, an event, or
     * once the row is gone. */
    returns: Array<{
      runId: string;
      startedAt: number;
      status: string;
      deliverySource: 'header' | 'body' | null;
      header: string | null;
    }>;
  };
  /** The version history, newest first, a page at a time: who saved each
   * version and through what, what it was based on and changed, its tests,
   * whether it is live and when it last went live. */
  'automations/queries:listVersionHistory': {
    kind: 'query';
    args: {
      organizationId: string;
      name: string;
      paginationOpts: { numItems: number; cursor: null | string };
    };
    returns: {
      page: VersionHistory['versions'];
      isDone: boolean;
      continueCursor: string;
    };
  };
  /** What is live now, since when, by whom and with how many of its runs
   * still going, and the deploys before it, newest first — the first
   * `limit` of them, or the page that starts `before` one. */
  'automations/queries:listDeployments': {
    kind: 'query';
    args: {
      organizationId: string;
      name: string;
      limit?: number;
      before?: { at: number; id: string };
    };
    returns: DeploymentHistory;
  };
  /** Every time a version went live, newest first, a page at a time. */
  'automations/queries:listDeploymentsPaginated': {
    kind: 'query';
    args: {
      organizationId: string;
      name: string;
      paginationOpts: { numItems: number; cursor: null | string };
    };
    returns: {
      page: DeploymentHistory['deployments'];
      isDone: boolean;
      continueCursor: string;
    };
  };
  /** Every version of an automation, newest first, as the history lists
   * it: who saved it and how, its lineage, changes and tests. */
  'automations/queries:listVersions': {
    kind: 'query';
    args: { organizationId: string; name: string };
    returns: VersionHistory['versions'];
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
