/** Sentinel `actorId` for workflow-engine task writes. */
export const WORKFLOW_ACTOR_ID = 'workflow';

/** Sentinel `actorId` for org provisioning / starter content (not a real agent). */
export const SYSTEM_ACTOR_ID = 'system';

export interface TaskActivityContext {
  workflowSlug?: string;
  wfExecutionId?: string;
}

export interface TaskActorPreviewLabels {
  /** Plain timeline label when the workflow cannot be resolved. */
  unresolvedWorkflow: string;
}

function humanizeWorkflowSlug(slug: string): string {
  // Workflow slugs are flat (slug === owning automation's slug); the basename
  // split only still matters for historical activity rows that captured a
  // retired foldered slug (e.g. `projects/tasks/run-assigned-task`).
  const base = slug.slice(slug.lastIndexOf('/') + 1);
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveWorkflowSlug(
  context?: TaskActivityContext,
): string | undefined {
  return context?.workflowSlug;
}

function resolveWorkflowName(args: {
  slug?: string;
  workflows: Map<string, TaskWorkflowCatalogEntry>;
}): string | undefined {
  if (!args.slug) return undefined;
  const wf = args.workflows.get(args.slug);
  return wf?.name ?? humanizeWorkflowSlug(args.slug);
}

export type TaskActorPreviewRoute =
  // The agents management page was removed, so an agent actor's "view" lands
  // on the org home rather than a dead link.
  | '/dashboard/$id'
  | '/dashboard/$id/automations/$automationSlug'
  | '/dashboard/$id/automations';

export interface TaskActorPreview {
  kind: 'agent' | 'workflow';
  name: string;
  description?: string;
  viewTo: TaskActorPreviewRoute;
  viewParams: { id: string; agentId?: string; automationSlug?: string };
  viewSearch?: { execution?: string };
}

export interface TaskActorCatalogEntry {
  name: string;
  description?: string;
}

export interface TaskWorkflowCatalogEntry {
  name: string;
  description?: string;
}

export function isWorkflowSentinel(
  actorType: string,
  actorId: string,
): boolean {
  return actorType === 'agent' && actorId === WORKFLOW_ACTOR_ID;
}

export function isSystemSentinel(actorType: string, actorId: string): boolean {
  return actorType === 'agent' && actorId === SYSTEM_ACTOR_ID;
}

/** Whether the activity timeline should show a hover preview for this actor. */
export function isPreviewableTaskActor(
  actorType: string,
  actorId: string,
): boolean {
  if (isSystemSentinel(actorType, actorId)) return false;
  return actorType === 'agent';
}

function workflowPreview(args: {
  organizationId: string;
  context?: TaskActivityContext;
  workflows: Map<string, TaskWorkflowCatalogEntry>;
}): TaskActorPreview | null {
  const slug = resolveWorkflowSlug(args.context);
  const name = resolveWorkflowName({ slug, workflows: args.workflows });
  if (!name) return null;
  const wf = slug ? args.workflows.get(slug) : undefined;
  return {
    kind: 'workflow',
    name,
    description: wf?.description,
    viewTo: slug
      ? '/dashboard/$id/automations/$automationSlug'
      : '/dashboard/$id/automations',
    viewParams: slug
      ? // A workflow's slug IS its owning automation's slug (flat) — usable
        // as the route param directly.
        { id: args.organizationId, automationSlug: slug }
      : { id: args.organizationId },
    viewSearch: args.context?.wfExecutionId
      ? { execution: args.context.wfExecutionId }
      : undefined,
  };
}

export function buildTaskActorPreview(args: {
  organizationId: string;
  actorType: 'user' | 'agent';
  actorId: string;
  context?: TaskActivityContext;
  agents: Map<string, TaskActorCatalogEntry>;
  workflows: Map<string, TaskWorkflowCatalogEntry>;
  labels: TaskActorPreviewLabels;
}): TaskActorPreview | null {
  if (!isPreviewableTaskActor(args.actorType, args.actorId)) return null;

  if (isSystemSentinel(args.actorType, args.actorId)) return null;

  if (isWorkflowSentinel(args.actorType, args.actorId)) {
    return workflowPreview(args);
  }

  const agent = args.agents.get(args.actorId);
  return {
    kind: 'agent',
    name: agent?.name ?? args.actorId,
    description: agent?.description,
    viewTo: '/dashboard/$id',
    viewParams: { id: args.organizationId },
  };
}

/** Preview for an agent-run row (metrics entry in the merged timeline). */
export function buildAgentRunPreview(args: {
  organizationId: string;
  agentSlug: string;
  workflowSlug?: string;
  wfExecutionId?: string;
  agents: Map<string, TaskActorCatalogEntry>;
  workflows: Map<string, TaskWorkflowCatalogEntry>;
  labels: TaskActorPreviewLabels;
}): TaskActorPreview {
  const agent = args.agents.get(args.agentSlug);
  const wf = args.workflowSlug
    ? args.workflows.get(args.workflowSlug)
    : undefined;

  return {
    kind: 'agent',
    name: agent?.name ?? args.agentSlug,
    description: agent?.description ?? wf?.description,
    // Agents management page removed → org home; the run's execution is no
    // longer deep-linkable from an agent view.
    viewTo: '/dashboard/$id',
    viewParams: { id: args.organizationId },
  };
}

/** Workflow-only preview when a run row links to its dispatching automation. */
export function buildWorkflowRunPreview(args: {
  organizationId: string;
  workflowSlug?: string;
  wfExecutionId?: string;
  workflows: Map<string, TaskWorkflowCatalogEntry>;
  labels: TaskActorPreviewLabels;
}): TaskActorPreview | null {
  if (!args.workflowSlug && !args.wfExecutionId) return null;
  return workflowPreview({
    organizationId: args.organizationId,
    context: {
      workflowSlug: args.workflowSlug,
      wfExecutionId: args.wfExecutionId,
    },
    workflows: args.workflows,
  });
}
