import type { TaskExternalIssue } from '@tale/shared/schemas/task-external-issue';
import type { ExternalStatusRequestInput } from '@tale/shared/schemas/task-external-status';
import type {
  ProjectTaskReviewer,
  SetTaskReviewerInput,
  TaskReviewer,
  TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';

import type { TaskStatusSnapshot } from '@/backend/domains/tasks/external-status';
import type { PendingTaskReview } from '@/backend/domains/tasks/reviews';
import type { TaskOpsRun } from '@/backend/domains/tasks/service';
import type { AgentRunWaitingReason } from '@/lib/shared/agent-run-waiting';
import type { TaskRepeat } from '@/lib/shared/task-repeat';

/**
 * `tasks` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../tasks.ts` are what
 * actually serve them.
 */

/**
 * One UTC day of a project's task metrics — the 0.3 `taskMetricsDaily` row
 * shape, folded at read time by the backend (`domains/tasks/metrics.ts`).
 * Sums + counts, so the page re-aggregates a window exactly.
 */
export interface ProjectTaskMetricsDay {
  dateKey: string;
  tasksCreated: number;
  tasksCompleted: number;
  tasksCancelled: number;
  cycleTimeSumMs: number;
  cycleTimeCount: number;
  leadTimeSumMs: number;
  leadTimeCount: number;
  statusCountsEod: {
    backlog: number;
    todo: number;
    in_progress: number;
    in_review: number;
  };
  wipEod: number;
  overdueEod: number;
  staleEod: number;
  agentCompleted: number;
  humanCompleted: number;
  agentRunsStarted: number;
  agentRunsFailed: number;
  totalCostCents: number;
  reviewsPassed: number;
  reviewsChangesRequested: number;
  escalations: number;
  capped: boolean;
}

/**
 * What a status change or a board move answers. `nextTask` is present only
 * when THIS write closed a repeating task and created its next copy.
 */
export type TaskStatusWriteResult = {
  nextTask?: { id: string; number?: number; dueDate?: number };
} | null;

export interface TaskReviewerState {
  reviewer: TaskReviewer;
  projectReviewer: ProjectTaskReviewer;
  pendingReview: PendingTaskReview | null;
}

export interface TaskPendingReviewIndicator {
  taskId: string;
  approvalId: string;
  requestedFor?: string;
  /** Captured recipient; an agent never falls back to a human designation. */
  reviewer?: TaskReviewRecipient | null;
}

/** One live agent run on the board's ops read: running, queued, or waiting
 * for a worker with its reason (`TaskOpsRun`). */
export type TaskOpsRunIndicator = TaskOpsRun;

/** The board and Home only read task metadata. Full descriptions and files
 * are loaded by the task detail read before its editor mounts. */
export type TaskBoardSummary = Omit<
  NonNullable<TasksContract['tasks/queries:getTask']['returns']>['task'],
  'description' | 'attachments' | 'outputs' | 'externalIssue'
>;

export interface TasksContract {
  'tasks/queries:getExternalStatus': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: TaskStatusSnapshot;
  };
  'tasks/mutations:requestExternalStatus': {
    kind: 'mutation';
    args: ExternalStatusRequestInput & {
      organizationId: string;
      taskId: string;
    };
    returns: TaskStatusSnapshot;
  };
  'tasks/queries:getTaskReviewer': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: TaskReviewerState;
  };
  'tasks/mutations:addTaskComment': {
    kind: 'mutation';
    args: { taskId: string; body: string };
    returns: {
      messageId: string;
      threadId: string;
      unresolvedMentionTokens: string[];
      automationTriggered: boolean;
    };
  };
  'tasks/mutations:addTaskDependency': {
    kind: 'mutation';
    args: { blockerTaskId: string; blockedTaskId: string };
    returns: null;
  };
  'tasks/mutations:archiveTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns: null;
  };
  'tasks/mutations:assignTask': {
    kind: 'mutation';
    args: {
      assigneeType?: 'user' | 'agent' | 'app';
      assigneeId?: string;
      taskId: string;
    };
    returns: null;
  };
  'tasks/mutations:cancelTaskAgentRun': {
    kind: 'mutation';
    args: { taskId: string };
    returns: null;
  };
  'tasks/mutations:createTask': {
    kind: 'mutation';
    args: {
      attachments?: Array<{
        fileId: string;
        fileName: string;
        fileType: string;
        fileSize: number;
      }>;
      status?:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      priority?: 'p0' | 'p1' | 'p2' | 'p3';
      dueDate?: number;
      description?: string;
      labels?: string[];
      assigneeType?: 'user' | 'agent' | 'app';
      assigneeId?: string;
      parentTaskId?: string;
      startDate?: number;
      repeat?: TaskRepeat;
      /** The conversation the task is handed over from (its root thread). */
      sourceThreadId?: string;
      organizationId: string;
      projectId: string;
      title: string;
    };
    returns: string;
  };
  'tasks/mutations:createTaskLabel': {
    kind: 'mutation';
    args: { name: string; projectId: string };
    returns: string;
  };
  'tasks/mutations:deleteTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns: { deletedChildCount: number };
  };
  'tasks/mutations:deleteTaskDiscussionMessage': {
    kind: 'mutation';
    args: { messageId: string };
    returns: null;
  };
  'tasks/mutations:deleteTaskLabel': {
    kind: 'mutation';
    args: { detach?: boolean; labelId: string };
    returns: null;
  };
  'tasks/mutations:editTaskDiscussionMessage': {
    kind: 'mutation';
    args: { messageId: string; body: string };
    returns: null;
  };
  'tasks/mutations:ensureDefaultTaskLabels': {
    kind: 'mutation';
    args: { projectId: string };
    returns: null;
  };
  'tasks/mutations:moveTask': {
    kind: 'mutation';
    args: {
      beforeTaskId?: string;
      afterTaskId?: string;
      status:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      taskId: string;
    };
    returns: TaskStatusWriteResult;
  };
  'tasks/mutations:removeTaskDependency': {
    kind: 'mutation';
    args: { blockerTaskId: string; blockedTaskId: string };
    returns: null;
  };
  'tasks/mutations:restoreTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns: null;
  };
  'tasks/mutations:startTaskAgentRun': {
    kind: 'mutation';
    args: { taskId: string };
    returns: { started: boolean; reason?: string };
  };
  /** "Stop repeating", from the task whose close created the next task:
   *  its series ends, and `removedNextTask` says whether that next task —
   *  still untouched — was taken back, or stays without a rule. */
  'tasks/mutations:stopTaskRepeat': {
    kind: 'mutation';
    /** `nextTaskId` never reaches the server: it names the next task whose
     *  reads must not refetch while the answer may still be "taken back". */
    args: { taskId: string; nextTaskId?: string };
    returns: { removedNextTask: boolean };
  };
  'tasks/mutations:updateTask': {
    kind: 'mutation';
    args: {
      attachments?: Array<{
        fileId: string;
        fileName: string;
        fileType: string;
        fileSize: number;
      }>;
      title?: string;
      priority?: null | 'p0' | 'p1' | 'p2' | 'p3';
      dueDate?: null | number;
      description?: null | string;
      labels?: string[];
      startDate?: null | number;
      /** `null` stops the series. */
      repeat?: null | TaskRepeat;
      taskId: string;
    };
    returns: null;
  };
  'tasks/mutations:updateTaskLabel': {
    kind: 'mutation';
    args: { name: string; labelId: string };
    returns: null;
  };
  'tasks/mutations:updateTaskStatus': {
    kind: 'mutation';
    args: {
      status:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      taskId: string;
    };
    returns: TaskStatusWriteResult;
  };
  'tasks/public_actions:cancelTaskWorkflow': {
    kind: 'action';
    args: {
      organizationId: string;
      taskId: string;
      /** Where the task lands once its run stops, in the same write; absent
       * parks it at Cancelled. In progress is the column a stop leaves. */
      status?: 'cancelled' | 'done' | 'in_review' | 'backlog' | 'todo';
      beforeTaskId?: string;
      afterTaskId?: string;
    };
    returns: {
      /** Whether the task now sits at Cancelled. */
      taskCancelled: boolean;
      executionCancelled: boolean;
      executionId: null | string;
    };
  };
  'tasks/public_actions:createTaskFromExternalIssue': {
    kind: 'action';
    args: {
      projectId?: string;
      description?: string;
      externalId?: string;
      automationSlug?: string;
      labels?: string[];
      externalUrl?: string;
      runWorkflowSlug?: string;
      ensureFolder?: { setupFolderName?: string; name: string };
      organizationId: string;
      title: string;
      externalSystem: string;
    };
    returns: {
      taskId: string;
      created: boolean;
      executionId?: null | string;
      folderId?: string;
    };
  };
  'tasks/public_actions:startTaskWorkflow': {
    kind: 'action';
    args: { organizationId: string; taskId: string; workflowSlug: string };
    returns: {
      started: boolean;
      executionId: null | string;
      reason?: 'already_running' | 'not_started';
    };
  };
  /** The tasks made from one conversation that the reader can open, newest
   * first — the chat's own row of them. */
  'tasks/queries:listTasksFromThread': {
    kind: 'query';
    args: { organizationId: string; threadId: string };
    returns: Array<{
      id: string;
      projectId: string;
      projectName: string;
      title: string;
      status:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      assigneeType: 'user' | 'agent' | 'app' | null;
      assigneeId: string | null;
      outputCount: number;
      run?: {
        status: 'queued' | 'running' | 'settled' | 'failed' | 'cancelled';
        failureCode?: string;
        retryPending?: boolean;
        waitingForCapacity?: boolean;
        /** Why it waits, while it waits and the park kept a reason. */
        waitingReason?: AgentRunWaitingReason;
      };
    }>;
  };
  'tasks/queries:getLatestTaskAgentRunForTask': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: null | {
      settledAt?: number;
      autoRetryMax: number;
      /** Who started the run: the person who may stop and steer it even
       * once the task is no longer theirs. */
      startedBy?: string;
      startedAt: number;
      autoRetryAttempt?: number;
      trigger?: 'manual' | 'mention' | 'auto_retry';
      waitingForCapacity?: boolean;
      /** Why it waits, while it waits and the park kept a reason. */
      waitingReason?: AgentRunWaitingReason;
      /** The worker it works in, while it holds one: its number among its
       * agent's workers (or the member's, for a run a member started). */
      worker?: number;
      resultText?: string;
      error?: string;
      /** The producer's classification of a failed run; the card words its
       * reason by it (`lib/shared/task-run-failure.ts`). */
      failureCode?: string;
      /** A failed run the platform is about to retry by itself. */
      retryPending?: boolean;
      harness: string;
      model: string;
      agentName?: string;
      _id: string;
      status: 'queued' | 'running' | 'failed' | 'cancelled' | 'settled';
      agentId: string;
    };
  };
  'tasks/queries:getProjectTaskMetrics': {
    kind: 'query';
    args: {
      organizationId: string;
      projectId: string;
      periodDays: 7 | 30 | 90;
    };
    returns: {
      daily: ProjectTaskMetricsDay[];
      previousDaily: ProjectTaskMetricsDay[];
    };
  };
  'tasks/queries:getTask': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: null | {
      task: {
        number?: number;
        attachments?: Array<{
          fileId: string;
          fileName: string;
          fileType: string;
          fileSize: number;
        }>;
        status:
          | 'cancelled'
          | 'done'
          | 'in_review'
          | 'backlog'
          | 'todo'
          | 'in_progress';
        rank: string;
        organizationId: string;
        projectId: string;
        createdBy: string;
        createdAt: number;
        _creationTime: number;
        updatedAt: number;
        claimedAt?: number;
        statusChangedAt?: number;
        title: string;
        threadId?: string;
        priority?: 'p0' | 'p1' | 'p2' | 'p3';
        dueDate?: number;
        description?: string;
        completedAt?: number;
        externalId?: string;
        reviewerUserId?: string;
        reviewerAgentId?: string;
        archivedAt?: number;
        createdByType: 'user' | 'agent' | 'app';
        outputs?: Array<{
          runId: string;
          fileId: string;
          fileName: string;
          fileType: string;
          fileSize: number;
          producedAt: number;
        }>;
        labelIds?: string[];
        assigneeType?: 'user' | 'agent' | 'app';
        assigneeId?: string;
        parentTaskId?: string;
        commentCount?: number;
        externalSystem?: string;
        externalUrl?: string;
        externalIssue?: TaskExternalIssue;
        startDate?: number;
        startNotifiedAt?: number;
        repeat?: TaskRepeat;
        repeatNextTaskId?: string;
        repeatContinued?: boolean;
        slaLevel?: number;
        slaLevelAt?: number;
        agentRunsPausedAt?: number;
        agentRunsPausedReason?: string;
        totalCostCents?: number;
        agentRunCount?: number;
        lastAgentRunAt?: number;
        discussionThreadId?: string;
        sourceDiscussionThreadId?: string;
        _id: string;
      } & { labels?: Array<{ id?: string; name: string; color: string }> } & {
        folderExists: boolean;
        hasFiles: boolean;
      };
      /** An editor of the task's (active) project: may work every task. */
      canEdit: boolean;
      /** A reader of the task's (active) project: may create tasks and work
       * their own (`canWorkTask`). */
      canCreate: boolean;
      canComment: boolean;
      /** Whose the task's parents are, nearest first: a subtask under the
       * viewer's own task is theirs to work too. */
      ancestors: Array<{
        createdBy: string;
        createdByType: string;
        assigneeType?: string | null;
        assigneeId?: string | null;
      }>;
    };
  };
  'tasks/queries:getTaskAgentRunSandboxOp': {
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
  /** The discussion as a NEWEST-FIRST page walk: the first page carries the
   * latest comments, each further page the ones before them. */
  'tasks/queries:listTaskDiscussion': {
    kind: 'query';
    args: {
      organizationId: string;
      taskId: string;
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
        messageId: string;
        authorType: 'user' | 'agent';
        authorId: string;
        body: string;
        createdAt: number;
        editedAt?: number;
        mentions?: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
        bodyByLocale?: Record<string, string>;
      }>;
      isDone: boolean;
      continueCursor: string;
    };
  };
  'tasks/queries:getTaskOpsIndicators': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: {
      runningTaskIds: string[];
      askingTaskIds: string[];
      pendingReviews: TaskPendingReviewIndicator[];
      /** Live agent runs, running first, then queued ones oldest first; at
       * most 50. */
      runs: TaskOpsRunIndicator[];
      /** More live runs exist than `runs` lists: a task missing from it may
       * still have one, so read it as unknown, never as idle. */
      runsTruncated: boolean;
    };
  };
  'tasks/queries:getTaskOpsIndicatorsForAccessibleProjects': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      runningTaskIds: string[];
      askingTaskIds: never[];
      pendingReviews: TaskPendingReviewIndicator[];
      runs: TaskOpsRunIndicator[];
      runsTruncated: boolean;
    };
  };
  'tasks/queries:listProjectDependencies': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{
      blockerTaskId: string;
      blockedTaskId: string;
      blockerResolved?: boolean;
    }>;
  };
  'tasks/queries:listSubtasks': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: Array<
      {
        number?: number;
        attachments?: Array<{
          fileId: string;
          fileName: string;
          fileType: string;
          fileSize: number;
        }>;
        status:
          | 'cancelled'
          | 'done'
          | 'in_review'
          | 'backlog'
          | 'todo'
          | 'in_progress';
        rank: string;
        organizationId: string;
        projectId: string;
        createdBy: string;
        createdAt: number;
        _creationTime: number;
        updatedAt: number;
        claimedAt?: number;
        statusChangedAt?: number;
        title: string;
        threadId?: string;
        priority?: 'p0' | 'p1' | 'p2' | 'p3';
        dueDate?: number;
        description?: string;
        completedAt?: number;
        externalId?: string;
        reviewerUserId?: string;
        reviewerAgentId?: string;
        archivedAt?: number;
        createdByType: 'user' | 'agent' | 'app';
        outputs?: Array<{
          runId: string;
          fileId: string;
          fileName: string;
          fileType: string;
          fileSize: number;
          producedAt: number;
        }>;
        labelIds?: string[];
        assigneeType?: 'user' | 'agent' | 'app';
        assigneeId?: string;
        parentTaskId?: string;
        commentCount?: number;
        externalSystem?: string;
        externalUrl?: string;
        externalIssue?: TaskExternalIssue;
        startDate?: number;
        startNotifiedAt?: number;
        repeat?: TaskRepeat;
        repeatNextTaskId?: string;
        repeatContinued?: boolean;
        slaLevel?: number;
        slaLevelAt?: number;
        agentRunsPausedAt?: number;
        agentRunsPausedReason?: string;
        totalCostCents?: number;
        agentRunCount?: number;
        lastAgentRunAt?: number;
        discussionThreadId?: string;
        sourceDiscussionThreadId?: string;
        _id: string;
      } & { labels?: Array<{ id?: string; name: string; color: string }> }
    >;
  };
  'tasks/queries:listTaskActivity': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: Array<{
      _id: string;
      _creationTime: number;
      context?: { wfExecutionId?: string; workflowSlug?: string };
      fromValue?: string;
      toValue?: string;
      organizationId: string;
      projectId: string;
      createdAt: number;
      taskId: string;
      actorType: 'user' | 'agent';
      actorId: string;
      action: string;
    }>;
  };
  'tasks/queries:listTaskAgentRuns': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: Array<{
      runId: string;
      agentSlug: string;
      trigger:
        | 'manual'
        | 'mention'
        | 'auto_retry'
        | 'automation'
        | 'delegated'
        | 'assignment'
        | 'revision'
        | 'sla_escalation'
        | 'unblock'
        | 'decomposition';
      status: 'running' | 'failed' | 'completed' | 'timed_out';
      error: undefined | string;
      failureCode: undefined | string;
      /** Queued while no worker or no room is free for it. */
      waitingForCapacity?: boolean;
      /** Why it waits, while it waits and the park kept a reason. */
      waitingReason?: AgentRunWaitingReason;
      /** The worker it works in, while it holds one. */
      worker?: number;
      startedAt: number;
      durationMs: undefined | number;
      costCents: number;
      workflowSlug: undefined | string;
      wfExecutionId: undefined | string;
      /** The project agent whose run started this one (`task_start_agent`). */
      delegatedByAgentId: undefined | string;
    }>;
  };
  'tasks/queries:listTaskDependencies': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: {
      blockedBy: Array<
        {
          number?: number;
          attachments?: Array<{
            fileId: string;
            fileName: string;
            fileType: string;
            fileSize: number;
          }>;
          status:
            | 'cancelled'
            | 'done'
            | 'in_review'
            | 'backlog'
            | 'todo'
            | 'in_progress';
          rank: string;
          organizationId: string;
          projectId: string;
          createdBy: string;
          createdAt: number;
          _creationTime: number;
          updatedAt: number;
          claimedAt?: number;
          statusChangedAt?: number;
          title: string;
          threadId?: string;
          priority?: 'p0' | 'p1' | 'p2' | 'p3';
          dueDate?: number;
          description?: string;
          completedAt?: number;
          externalId?: string;
          reviewerUserId?: string;
          reviewerAgentId?: string;
          archivedAt?: number;
          createdByType: 'user' | 'agent' | 'app';
          outputs?: Array<{
            runId: string;
            fileId: string;
            fileName: string;
            fileType: string;
            fileSize: number;
            producedAt: number;
          }>;
          labelIds?: string[];
          assigneeType?: 'user' | 'agent' | 'app';
          assigneeId?: string;
          parentTaskId?: string;
          commentCount?: number;
          externalSystem?: string;
          externalUrl?: string;
          externalIssue?: TaskExternalIssue;
          startDate?: number;
          startNotifiedAt?: number;
          repeat?: TaskRepeat;
          repeatNextTaskId?: string;
          repeatContinued?: boolean;
          slaLevel?: number;
          slaLevelAt?: number;
          agentRunsPausedAt?: number;
          agentRunsPausedReason?: string;
          totalCostCents?: number;
          agentRunCount?: number;
          lastAgentRunAt?: number;
          discussionThreadId?: string;
          sourceDiscussionThreadId?: string;
          _id: string;
        } & { labels?: Array<{ id?: string; name: string; color: string }> }
      >;
      blocks: Array<
        {
          number?: number;
          attachments?: Array<{
            fileId: string;
            fileName: string;
            fileType: string;
            fileSize: number;
          }>;
          status:
            | 'cancelled'
            | 'done'
            | 'in_review'
            | 'backlog'
            | 'todo'
            | 'in_progress';
          rank: string;
          organizationId: string;
          projectId: string;
          createdBy: string;
          createdAt: number;
          _creationTime: number;
          updatedAt: number;
          claimedAt?: number;
          statusChangedAt?: number;
          title: string;
          threadId?: string;
          priority?: 'p0' | 'p1' | 'p2' | 'p3';
          dueDate?: number;
          description?: string;
          completedAt?: number;
          externalId?: string;
          reviewerUserId?: string;
          reviewerAgentId?: string;
          archivedAt?: number;
          createdByType: 'user' | 'agent' | 'app';
          outputs?: Array<{
            runId: string;
            fileId: string;
            fileName: string;
            fileType: string;
            fileSize: number;
            producedAt: number;
          }>;
          labelIds?: string[];
          assigneeType?: 'user' | 'agent' | 'app';
          assigneeId?: string;
          parentTaskId?: string;
          commentCount?: number;
          externalSystem?: string;
          externalUrl?: string;
          externalIssue?: TaskExternalIssue;
          startDate?: number;
          startNotifiedAt?: number;
          repeat?: TaskRepeat;
          repeatNextTaskId?: string;
          repeatContinued?: boolean;
          slaLevel?: number;
          slaLevelAt?: number;
          agentRunsPausedAt?: number;
          agentRunsPausedReason?: string;
          totalCostCents?: number;
          agentRunCount?: number;
          lastAgentRunAt?: number;
          discussionThreadId?: string;
          sourceDiscussionThreadId?: string;
          _id: string;
        } & { labels?: Array<{ id?: string; name: string; color: string }> }
      >;
    };
  };
  'tasks/queries:listTaskLabels': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{ _id: string; name: string; color: string }>;
  };
  'tasks/queries:listTasksByProject': {
    kind: 'query';
    args: {
      status?:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      assigneeId?: string;
      externalSystem?: string;
      statuses?: Array<
        'cancelled' | 'done' | 'in_review' | 'backlog' | 'todo' | 'in_progress'
      >;
      includeArchived?: boolean;
      /** The toolbar's search, applied with the other filters (`q`). */
      query?: string;
      organizationId: string;
      projectId: string;
    };
    returns: {
      tasks: TaskBoardSummary[];
      truncated: boolean;
      /** An editor of the (active) project: may work every task on it. */
      canEdit: boolean;
      /** A reader of the (active) project: may create tasks and work their
       * own (`canWorkTask`). */
      canCreate: boolean;
    };
  };
  'tasks/queries:listTasksForAccessibleProjects': {
    kind: 'query';
    args: {
      status?:
        | 'cancelled'
        | 'done'
        | 'in_review'
        | 'backlog'
        | 'todo'
        | 'in_progress';
      assigneeId?: string;
      reviewerId?: string;
      statuses?: Array<
        'cancelled' | 'done' | 'in_review' | 'backlog' | 'todo' | 'in_progress'
      >;
      includeArchived?: boolean;
      /** The toolbar's search, applied with the other filters (`q`). */
      query?: string;
      organizationId: string;
    };
    returns: {
      tasks: Array<TaskBoardSummary & { projectKey?: string }>;
      truncated: boolean;
      /** Role-level: an editor role works every task on the board. */
      canEdit: boolean;
      /** Role-level: every member creates and works their own tasks. */
      canCreate: boolean;
    };
  };
  'tasks/queries:mentionTriggerPreview': {
    kind: 'query';
    args: {
      projectId?: string;
      taskId?: string;
      organizationId: string;
      slugs: string[];
    };
    returns: Array<{
      slug: string;
      willTrigger: boolean;
      reason:
        | 'ok'
        | 'queued_likely'
        | 'agent_not_live'
        | 'pack_disabled'
        | 'breaker_paused'
        | 'budget_paused'
        | 'not_permitted'
        | 'standard_agent_unavailable';
    }>;
  };
  'tasks/review_mutations:setTaskReviewer': {
    kind: 'mutation';
    args: SetTaskReviewerInput & { taskId: string };
    returns: null;
  };
  'tasks/search:searchTasks': {
    kind: 'query';
    args: { projectId?: string; organizationId: string; query: string };
    returns: Array<{
      taskId: string;
      projectId: string;
      title: string;
      status:
        | 'backlog'
        | 'todo'
        | 'in_progress'
        | 'in_review'
        | 'done'
        | 'cancelled';
      snippet: string;
      updatedAt: number;
      number?: number;
      projectKey?: string;
      archived?: true;
      projectArchived?: true;
    }>;
  };
  'tasks/serving_preview:previewUnpinnedTaskServing': {
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
}
