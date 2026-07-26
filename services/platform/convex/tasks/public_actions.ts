import { ConvexError, v } from 'convex/values';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { type ActionCtx, action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { parseIssueNumber, parseRepoRef } from './issue_ref';

/**
 * Start a workflow ON an existing task, subject-linked so any UI showing the
 * task's run picks it up. Derives the upstream issue number from the task's
 * externalId ("owner/repo#N"); null for non-issue tasks (the workflow only
 * string-interpolates it). Shared by the create→run path and the manual
 * (re-)trigger. Never rejects: the task is already committed, so a start failure
 * returns null ("run not started") rather than stranding the task — the caller
 * surfaces that to the user.
 */
async function startWorkflowForTask(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    task: Doc<'tasks'>;
    workflowSlug: string;
    startedByUserId: string;
  },
): Promise<{ runId: string; alreadyRunning: boolean } | null> {
  const issueNumber = parseIssueNumber(args.task.externalId);
  // owner/repo from the same "owner/repo#N" ref, so a workflow can address the
  // upstream issue (e.g. the desk pre-check's get_issue) without re-parsing;
  // null for a non-issue/malformed ref, which the workflow guards on.
  const repoRef = parseRepoRef(args.task.externalId);
  try {
    // The workflow slug names a DEPLOYED automation of this organization; the
    // run carries the task as its input — the same contract the retired
    // engine's task workflows had. Not-deployed degrades to "not started",
    // which callers already handle.
    const started = await ctx.runMutation(
      internal.automations.mutations.startTaskWorkflowRun,
      {
        organizationId: args.organizationId,
        name: args.workflowSlug,
        taskId: String(args.task._id),
        startedBy: `user:${args.startedByUserId}`,
        input: {
          task: {
            id: String(args.task._id),
            title: args.task.title,
            status: args.task.status,
            projectId: String(args.task.projectId),
            ...(args.task.externalSystem !== undefined
              ? { externalSystem: args.task.externalSystem }
              : {}),
            ...(args.task.externalId !== undefined
              ? { externalId: args.task.externalId }
              : {}),
            ...(args.task.externalUrl !== undefined
              ? { externalUrl: args.task.externalUrl }
              : {}),
            ...(issueNumber !== null ? { issueNumber } : {}),
            ...(repoRef !== null
              ? { repo: `${repoRef.owner}/${repoRef.repo}` }
              : {}),
          },
        },
      },
    );
    if (started === null) {
      console.warn(
        '[task-workflow] start skipped — no deployed automation named',
        args.workflowSlug,
      );
      return null;
    }
    return {
      runId: String(started.runId),
      alreadyRunning: started.alreadyRunning === true,
    };
  } catch (err) {
    console.error(
      '[task-workflow] workflow start failed',
      args.workflowSlug,
      err,
    );
    return null;
  }
}

/**
 * Public, org-gated wrapper to create a task BOUND to an external issue
 * (`externalSystem`/`externalId`/`externalUrl`). The upsert that carries the
 * external ref is internal-only and needs an actor, so this thin action supplies
 * the authenticated user as the actor and defaults the destination project to
 * the org's project. Idempotent within the materialization scope: an explicit
 * `projectId` (a project-scoped app) dedups PER PROJECT, so the same issue picked
 * in two projects yields two independent tasks; the org-wide fallback (an
 * org-scoped/legacy caller) dedups per org. Picking the same issue twice in the
 * same scope updates rather than duplicates. The created task is reactive, so
 * the rest of the view (the tasks Collection) reflects it live.
 *
 * When `runWorkflowSlug` is set, a NEWLY created task also schedules that
 * workflow on itself (subject-linked) — the app-scoped create→run: only THIS
 * app's create runs THIS workflow, never an org-global task event (which would
 * mis-fire on tasks from other apps/channels). Skipped on idempotent re-pick
 * (created=false). Start is scheduled (not awaited) so the create action
 * returns as soon as the task exists and the desk can latch Created.
 */
export const createTaskFromExternalIssue = action({
  args: {
    organizationId: v.string(),
    /**
     * Project the task belongs to — supplied by a project-scoped app via the
     * `$projectId` binding. Absent for legacy/org callers, which fall back to
     * the org-wide project (with a warning) rather than guessing silently.
     */
    projectId: v.optional(v.id('projects')),
    externalSystem: v.string(),
    externalId: v.optional(v.string()),
    /**
     * Materialize the task's external subject as a project ROOT FOLDER in
     * the same gesture — for folder-driven desks whose "external issue" IS a
     * project folder. `name` creates (or reuses, by name) the root folder
     * and becomes the task's `externalId`; `setupFolderName` resolves the
     * sibling setup folder's id into `externalUrl` (the desks' binding
     * convention) and fails closed when that folder does not exist yet.
     * Requires `projectId`; mutually exclusive with `externalId`.
     */
    ensureFolder: v.optional(
      v.object({
        name: v.string(),
        setupFolderName: v.optional(v.string()),
      }),
    ),
    title: v.string(),
    externalUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    /** App workflow slug to run on the newly created task (app-scoped). */
    runWorkflowSlug: v.optional(v.string()),
  },
  returns: v.object({
    taskId: v.string(),
    created: v.boolean(),
    executionId: v.optional(v.union(v.string(), v.null())),
    folderId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    taskId: string;
    created: boolean;
    executionId?: string | null;
    folderId?: string;
  }> => {
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);

    if (!args.externalId === !args.ensureFolder) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENTS',
        message: 'Provide exactly one of externalId or ensureFolder',
      });
    }
    if (args.ensureFolder && !args.projectId) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENTS',
        message: 'ensureFolder requires an explicit projectId',
      });
    }

    // Project-scoped apps pass their bound project explicitly; validate it.
    // Without one (legacy/org caller), fall back to the org-wide project and
    // warn — never silently guess a user project.
    let projectId: Id<'projects'>;
    if (args.projectId) {
      const project = await ctx.runQuery(api.projects.queries.getProject, {
        projectId: args.projectId,
        organizationId: args.organizationId,
      });
      // getProject now enforces active-org coherence (returns null when the
      // project is not in args.organizationId), so a non-null result is in-org.
      if (!project) {
        throw new Error('Target project not found in this organization');
      }
      projectId = args.projectId;
    } else {
      const projects = await ctx.runQuery(api.projects.queries.listProjects, {
        organizationId: args.organizationId,
      });
      const fallback = projects.find((p) => p.isOrgWide) ?? projects[0];
      if (!fallback) {
        throw new Error('No project available — create a project first');
      }
      console.warn(
        '[create-task] no projectId supplied; falling back to org-wide project',
        { organizationId: args.organizationId, projectId: fallback._id },
      );
      projectId = fallback._id;
    }

    // Folder-driven flow: the folder is the external subject — make (or find)
    // it, then bind the task to its id. The setup-folder id rides externalUrl
    // per the desks' binding convention; its absence fails closed so a task
    // can never be born pointing at a setup that does not exist.
    let externalId = args.externalId;
    let externalUrl = args.externalUrl;
    let ensuredFolderId: string | undefined;
    if (args.ensureFolder) {
      const folder = await ctx.runMutation(
        internal.folders.internal_mutations.getOrCreateProjectRootFolder,
        {
          organizationId: args.organizationId,
          projectId,
          name: args.ensureFolder.name,
          userId,
        },
      );
      externalId = folder.folderId;
      ensuredFolderId = folder.folderId;
      const setupName = args.ensureFolder.setupFolderName;
      if (setupName !== undefined && externalUrl === undefined) {
        const setup = await ctx.runQuery(
          api.projects.queries.getProjectSetupFolder,
          {
            projectId,
            organizationId: args.organizationId,
            setupFolderName: setupName,
          },
        );
        if (!setup) {
          throw new ConvexError({
            code: 'SETUP_FOLDER_MISSING',
            message: `Folder "${setupName}" does not exist in this project yet`,
          });
        }
        externalUrl = setup._id;
      }
    }
    if (!externalId) {
      throw new ConvexError({
        code: 'INVALID_ARGUMENTS',
        message: 'externalId did not resolve',
      });
    }

    const result = await ctx.runMutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: args.organizationId,
        actorId: userId,
        projectId,
        externalSystem: args.externalSystem,
        externalId,
        title: args.title,
        externalUrl,
        description: args.description,
        labels: args.labels,
        externalState: 'open',
        // Attributes the task to the owning app (createdByType:'app') so generic
        // task automation defers to the app's workflow — see the upsert mutation.
        runWorkflowSlug: args.runWorkflowSlug,
        // An explicit project (a project-scoped app) dedups per project so two
        // projects each get their own task; the org-wide fallback dedups per org.
        dedupeScope: args.projectId ? 'project' : 'org',
      },
    );
    // Creation is unconditional here (a projectId is always resolved above and
    // createIfMissing defaults true), so a null id is unreachable — guard it
    // anyway since the upsert now returns null for update-only reconciles.
    const taskId = result.taskId;
    if (!taskId) {
      throw new Error('Failed to create or find the task for this issue');
    }

    let executionId: string | null | undefined;
    if (args.runWorkflowSlug && result.created) {
      // Schedule — do not await startWorkflowFromFile here. Nested action depth
      // from create→start blocked the client for tens of seconds in CI (desk
      // Start never latched Created). The task row is already committed; Jobs
      // Start remains the recovery path if the scheduled kick fails.
      await ctx.runMutation(
        internal.tasks.internal_mutations.scheduleTaskWorkflowStart,
        {
          organizationId: args.organizationId,
          taskId,
          workflowSlug: args.runWorkflowSlug,
          userId,
        },
      );
      executionId = null;
    }

    return {
      taskId,
      created: result.created,
      executionId,
      ...(ensuredFolderId !== undefined ? { folderId: ensuredFolderId } : {}),
    };
  },
});

/**
 * Manually (re-)trigger a workflow on an existing task — the Tasks-board "Start"
 * affordance, and the recovery path when a create-launched run failed for any
 * reason (e.g. a bad agent credential). Starts a fresh, subject-linked run; the
 * workflow itself owns the task's status (its `ack` step → in_progress, its
 * failure/rollback path → todo), so this never writes status directly.
 *
 * Guarded against duplicate concurrent runs: while a run for this task is still
 * pending/running, refuses (returns the in-flight executionId) rather than
 * racing a second run over the same `tale/<taskId>` git branch + PR.
 */
export const startTaskWorkflow = action({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    workflowSlug: v.string(),
  },
  returns: v.object({
    started: v.boolean(),
    executionId: v.union(v.string(), v.null()),
    reason: v.optional(
      v.union(v.literal('already_running'), v.literal('not_started')),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    started: boolean;
    executionId: string | null;
    reason?: 'already_running' | 'not_started';
  }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);

    const loaded = await ctx.runQuery(api.tasks.queries.getTask, {
      taskId: args.taskId,
      organizationId: args.organizationId,
    });
    if (!loaded?.task) {
      throw new Error('Task not found');
    }

    const started = await startWorkflowForTask(ctx, {
      organizationId: args.organizationId,
      task: loaded.task,
      workflowSlug: args.workflowSlug,
      startedByUserId: auth.userId,
    });
    if (!started) {
      return { started: false, reason: 'not_started', executionId: null };
    }
    if (started.alreadyRunning) {
      return {
        started: false,
        reason: 'already_running',
        executionId: started.runId,
      };
    }
    return { started: true, executionId: started.runId };
  },
});

/**
 * Cancel the in-flight subject-linked run for a task (if any), then park the
 * task at `cancelled` so desk Start can re-trigger. Pair of {@link startTaskWorkflow}:
 * Start begins execution; Cancel stops it. Idempotent when nothing is running —
 * still moves the task to `cancelled` so a stuck `in_progress` row can be restarted.
 */
export const cancelTaskWorkflow = action({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
  },
  returns: v.object({
    taskCancelled: v.boolean(),
    executionCancelled: v.boolean(),
    executionId: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    taskCancelled: boolean;
    executionCancelled: boolean;
    executionId: string | null;
  }> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const loaded = await ctx.runQuery(api.tasks.queries.getTask, {
      taskId: args.taskId,
      organizationId: args.organizationId,
    });
    if (!loaded?.task) {
      throw new Error('Task not found');
    }

    // No executions can be active while the automation engine is rebuilt —
    // there is nothing to cancel; the task itself still gets cancelled below.
    const executionCancelled = false;
    const executionId: string | null = null;

    if (loaded.task.status !== 'cancelled') {
      await ctx.runMutation(api.tasks.mutations.updateTaskStatus, {
        taskId: args.taskId,
        status: 'cancelled',
      });
    }

    return {
      taskCancelled: true,
      executionCancelled,
      executionId,
    };
  },
});

/**
 * Merge the pull request a task's issue-desk run produced, then close the task.
 * The run parks the task at `in_review` (the PR was opened during the implement
 * step); this powers the human "Merge" affordance on the finished run. The PR
 * number isn't in structured step output, so derive `owner/repo` from the task's
 * `externalId` and find the PR by the implementer's deterministic head branch
 * `tale/<taskId>`.
 *
 * Idempotent: an OPEN PR is squash-merged; a PR that is ALREADY merged counts as
 * success (no-op merge). Either way the task is closed to `done`. The explicit
 * user click (+ confirm) authorizes the merge, so the integration approval gate
 * is skipped — `merge_pull_request` stays `requiresApproval` for any
 * agent/workflow caller.
 */
export const mergeTaskPullRequest = action({
  args: {
    organizationId: v.string(),
    taskId: v.id('tasks'),
    mergeMethod: v.optional(
      v.union(v.literal('merge'), v.literal('squash'), v.literal('rebase')),
    ),
  },
  returns: v.object({
    merged: v.boolean(),
    pullNumber: v.number(),
    alreadyMerged: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    merged: boolean;
    pullNumber: number;
    alreadyMerged: boolean;
  }> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    const loaded = await ctx.runQuery(api.tasks.queries.getTask, {
      taskId: args.taskId,
      organizationId: args.organizationId,
    });
    if (!loaded?.task) {
      throw new Error('Task not found');
    }
    const repoRef = parseRepoRef(loaded.task.externalId);
    if (!repoRef) {
      throw new Error(
        'This task is not linked to a GitHub repository, so its pull request cannot be merged.',
      );
    }
    // Merging rides the integrations backend (GitHub connector), which is
    // offline while it is rebuilt. Fail with a typed error the task UI can
    // render; the pull request itself is untouched and can be merged on
    // GitHub directly in the meantime.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'Merging from Tale is unavailable right now: the integrations backend is offline while it is rewritten. Merge the pull request on GitHub directly.',
    });
  },
});
