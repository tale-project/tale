/**
 * `tasks` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../tasks.ts` are what
 * actually serve them.
 */

export interface TasksContract {
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
  'tasks/mutations:claimTask': {
    kind: 'mutation';
    args: { taskId: string };
    returns:
      | { claimed: boolean; reason: string }
      | { claimed: boolean; reason?: undefined };
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
    returns: null;
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
    returns: null;
  };
  'tasks/public_actions:cancelTaskWorkflow': {
    kind: 'action';
    args: { organizationId: string; taskId: string };
    returns: {
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
  'tasks/queries:getLatestTaskAgentRunForTask': {
    kind: 'query';
    args: { organizationId: string; taskId: string };
    returns: null | {
      settledAt?: number;
      autoRetryMax: number;
      startedAt: number;
      autoRetryAttempt?: number;
      trigger?: 'manual' | 'mention' | 'auto_retry';
      waitingForCapacity?: boolean;
      resultText?: string;
      error?: string;
      harness: string;
      model: string;
      agentName?: string;
      _id: string;
      status: 'queued' | 'running' | 'failed' | 'cancelled' | 'settled';
      agentId: string;
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
        startDate?: number;
        startNotifiedAt?: number;
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
      canEdit: boolean;
      canClaim: boolean;
      canComment: boolean;
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
        bodyByLocale?: { en: string; de: string; fr: string };
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
      pendingReviews: Array<
        | ({ taskId: string; approvalId: string } & { requestedFor: string })
        | ({ taskId: string; approvalId: string } & {
            requestedFor?: undefined;
          })
      >;
    };
  };
  'tasks/queries:getTaskOpsIndicatorsForAccessibleProjects': {
    kind: 'query';
    args: { organizationId: string };
    returns: {
      runningTaskIds: string[];
      askingTaskIds: never[];
      pendingReviews: Array<
        | ({ taskId: string; approvalId: string } & { requestedFor: string })
        | ({ taskId: string; approvalId: string } & {
            requestedFor?: undefined;
          })
      >;
    };
  };
  'tasks/queries:listProjectDependencies': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{ blockerTaskId: string; blockedTaskId: string }>;
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
        startDate?: number;
        startNotifiedAt?: number;
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
        | 'assignment'
        | 'revision'
        | 'sla_escalation'
        | 'unblock'
        | 'decomposition';
      status: 'running' | 'failed' | 'completed' | 'timed_out';
      error: undefined | string;
      startedAt: number;
      durationMs: undefined | number;
      costCents: number;
      workflowSlug: undefined | string;
      wfExecutionId: undefined | string;
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
          startDate?: number;
          startNotifiedAt?: number;
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
          startDate?: number;
          startNotifiedAt?: number;
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
      organizationId: string;
      projectId: string;
    };
    returns: {
      tasks: Array<
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
          startDate?: number;
          startNotifiedAt?: number;
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
        }
      >;
      truncated: boolean;
      canEdit: boolean;
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
      statuses?: Array<
        'cancelled' | 'done' | 'in_review' | 'backlog' | 'todo' | 'in_progress'
      >;
      includeArchived?: boolean;
      organizationId: string;
    };
    returns: {
      tasks: Array<
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
          startDate?: number;
          startNotifiedAt?: number;
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
          projectKey?: string;
          folderExists: boolean;
          hasFiles: boolean;
        }
      >;
      truncated: boolean;
      canEdit: boolean;
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
        | 'not_mentionable'
        | 'agent_not_live'
        | 'pack_disabled'
        | 'breaker_paused'
        | 'budget_paused';
    }>;
  };
  'tasks/review_mutations:setTaskReviewer': {
    kind: 'mutation';
    args: { reviewerUserId?: string; taskId: string };
    returns: null;
  };
  'tasks/search:searchTasks': {
    kind: 'query';
    args: { projectId?: string; organizationId: string; query: string };
    returns: Array<{
      taskId: string;
      projectId: string;
      title: string;
      snippet: string;
      updatedAt: number;
      number?: number;
      projectKey?: string;
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
