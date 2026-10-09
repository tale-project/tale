/**
 * Automations vertical over the 0.5 backend — the editor, the run log, the
 * triggers/projects bindings, the metrics page, the node-type catalog, and
 * the package-upload lane. The store server landed in the automations
 * module increments; this file is the adapter rows (plus the two already
 * living in `tasks.ts`/`projects.ts`: `getLiveRunForTask`,
 * `listAutomations`). Response types are DERIVED from the 0.4 signatures.
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';
import {
  nodeTypeCatalogSchema,
  type NodeTypeCatalog,
} from '@/lib/shared/schemas/node-type-catalog';

import type {
  ActionQueryAdapter,
  AdapterContext,
  ReadAdapter,
  WriteAdapter,
} from './adapters';
import { backendFetch, backendUrl } from './api-client';
import { backendEntityPrefix, backendKey } from './query-keys';

type GetAutomationResult = ReturnsOf<'automations/queries:getAutomation'>;
type ListVersionsResult = ReturnsOf<'automations/queries:listVersions'>;
type ListTriggersResult = ReturnsOf<'automations/queries:listTriggers'>;
type ListRunsResult = ReturnsOf<'automations/queries:listRuns'>;
type GetRunResult = ReturnsOf<'automations/queries:getRun'>;
type PendingAskResult = ReturnsOf<'automations/human_asks:getPendingAskForRun'>;
type RunRecordResult = ReturnsOf<'automations/queries:getRunRecord'>;
type RunNodeResult = ReturnsOf<'automations/queries:getRunNode'>;
type RunItemsResult = ReturnsOf<'automations/queries:getRunItems'>;
type CompareRunsResult = ReturnsOf<'automations/queries:compareRuns'>;
type ReplayPlanResult = ReturnsOf<'automations/queries:getReplayPlan'>;
type ReplayRunResult = ReturnsOf<'automations/mutations:replayRun'>;
type RunInDoubtResult = ReturnsOf<'automations/queries:getRunInDoubt'>;
type OrgAutomationMetricsResult =
  ReturnsOf<'automations/queries:getOrgAutomationMetrics'>;
type ApprovalResult = ReturnsOf<'approvals/queries:getApproval'>;
type AutomationCapabilitiesResult =
  ReturnsOf<'chat/composer:listAutomationCapabilities'>;
type SaveAutomationResult = ReturnsOf<'automations/mutations:saveAutomation'>;
type DeployResult = ReturnsOf<'automations/mutations:deployAutomation'>;
type SetTriggerResult = ReturnsOf<'automations/mutations:setTrigger'>;
type CancelRunResult = ReturnsOf<'automations/mutations:cancelRun'>;
type DeleteAutomationResult =
  ReturnsOf<'automations/mutations:deleteAutomation'>;
type UploadAutomationResult =
  ReturnsOf<'automations/upload_action:uploadAutomation'>;

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

/** The attempt an in-doubt decision is about: without it the door could
 * not tell an earlier attempt of a write from a later one. */
function attemptArg(args: Record<string, unknown>): number {
  const value = args.attempt;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('Missing attempt for adapted write');
  }
  return value;
}

/** Automation names are '/'-separated paths — encode per segment. */
export function namePath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

export const automationReadAdapters: Record<string, ReadAdapter> = {
  'automations/queries:getAutomation': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const name = args.name;
    if (orgId === undefined || typeof name !== 'string') return null;
    const version = typeof args.version === 'number' ? args.version : undefined;
    return {
      queryKey: backendKey(
        orgId,
        'automation',
        'detail',
        name,
        version === undefined ? 'latest' : String(version),
      ),
      queryFn: () =>
        backendFetch<GetAutomationResult>(
          `/automations/${namePath(name)}${version === undefined ? '' : `?version=${version}`}`,
          { orgId },
        ),
    };
  },
  'automations/queries:listVersions': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const name = args.name;
    if (orgId === undefined || typeof name !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation', 'versions', name),
      queryFn: () =>
        backendFetch<{ versions: ListVersionsResult }>(
          `/automations/${namePath(name)}/versions`,
          { orgId },
        ).then((body) => body.versions),
    };
  },
  'automations/queries:listTriggers': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const name = args.name;
    if (orgId === undefined || typeof name !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation', 'triggers', name),
      queryFn: () =>
        backendFetch<{ triggers: ListTriggersResult }>(
          `/automations/${namePath(name)}/triggers`,
          { orgId },
        ).then((body) => body.triggers),
    };
  },
  'automations/queries:listAutomationProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const name = args.name;
    if (orgId === undefined || typeof name !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation', 'projects', name),
      queryFn: () =>
        backendFetch<{ projectIds: string[] }>(
          `/automations/${namePath(name)}/projects`,
          { orgId },
        ).then((body) => body.projectIds),
    };
  },
  'automations/queries:listRuns': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const name = typeof args.name === 'string' ? args.name : '';
    const limit = typeof args.limit === 'number' ? args.limit : 50;
    const projectId = typeof args.projectId === 'string' ? args.projectId : '';
    const qs =
      `?limit=${limit}` +
      (name !== '' ? `&name=${encodeURIComponent(name)}` : '') +
      (projectId !== '' ? `&projectId=${encodeURIComponent(projectId)}` : '');
    return {
      queryKey: backendKey(
        orgId,
        'automation_run',
        'list',
        name,
        String(limit),
        projectId,
      ),
      queryFn: () =>
        backendFetch<{ runs: unknown[] }>(`/automations/runs${qs}`, {
          orgId,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg run rows are the 0.4 doc superset; ids bridged
        }).then((body) => mapRunIds(body.runs) as unknown as ListRunsResult),
    };
  },
  'automations/queries:getRun': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    if (orgId === undefined || typeof runId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation_run', 'detail', runId),
      queryFn: () =>
        backendFetch<{ run: Record<string, unknown> & { id: string } }>(
          `/automations/runs/${encodeURIComponent(runId)}`,
          { orgId },
        ).then(
          (body) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg run rows are the 0.4 doc superset; ids bridged
            ({
              ...body.run,
              _id: body.run.id,
              projectId:
                typeof body.run.projectId === 'string'
                  ? body.run.projectId
                  : undefined,
            }) as unknown as GetRunResult,
        ),
    };
  },
  'automations/human_asks:getPendingAskForRun': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    if (orgId === undefined || typeof runId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation_run', 'ask', runId),
      queryFn: () =>
        backendFetch<{ ask: PendingAskResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/ask`,
          { orgId },
        ).then((body) => body.ask),
    };
  },
  // A run step by step. Keyed under the run, so its own hint refreshes the
  // record, the open step and the open page; `since` asks only for what
  // changed after a cursor, for a reader that merges.
  'automations/queries:getRunRecord': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    if (orgId === undefined || typeof runId !== 'string') return null;
    const params = new URLSearchParams();
    if (typeof args.since === 'number') params.set('since', String(args.since));
    if (args.travels === true) params.set('include', 'travels');
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    return {
      queryKey: backendKey(
        orgId,
        'automation_run',
        'record',
        runId,
        typeof args.since === 'number' ? args.since : null,
        args.travels === true,
      ),
      queryFn: () =>
        backendFetch<{ record: RunRecordResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/record${qs}`,
          { orgId },
        ).then((body) => body.record),
    };
  },
  'automations/queries:getRunNode': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    const node = args.node;
    if (
      orgId === undefined ||
      typeof runId !== 'string' ||
      typeof node !== 'string'
    ) {
      return null;
    }
    const item = typeof args.item === 'number' ? args.item : -1;
    const pass = typeof args.pass === 'number' ? args.pass : -1;
    const params = new URLSearchParams({
      node,
      item: String(item),
      pass: String(pass),
    });
    return {
      queryKey: backendKey(
        orgId,
        'automation_run',
        'node',
        runId,
        node,
        item,
        pass,
      ),
      queryFn: () =>
        backendFetch<{ node: RunNodeResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/record/node?${params.toString()}`,
          { orgId },
        ).then((body) => body.node),
    };
  },
  'automations/queries:getRunItems': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    const node = args.node;
    if (
      orgId === undefined ||
      typeof runId !== 'string' ||
      typeof node !== 'string'
    ) {
      return null;
    }
    const params = new URLSearchParams({ node });
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    if (args.status === 'failed') params.set('status', 'failed');
    return {
      queryKey: backendKey(
        orgId,
        'automation_run',
        'items',
        runId,
        node,
        params.toString(),
      ),
      queryFn: () =>
        backendFetch<{ page: RunItemsResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/record/items?${params.toString()}`,
          { orgId },
        ).then((body) => body.page),
    };
  },
  'automations/queries:compareRuns': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    const otherRunId = args.otherRunId;
    if (
      orgId === undefined ||
      typeof runId !== 'string' ||
      typeof otherRunId !== 'string'
    ) {
      return null;
    }
    // Not under the run's own entity: a run's progress hint must not run
    // the comparison of two finished runs again.
    return {
      queryKey: backendKey(orgId, 'automation_run_compare', runId, otherRunId),
      queryFn: () =>
        backendFetch<{ diff: CompareRunsResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/compare/${encodeURIComponent(otherRunId)}`,
          { orgId },
        ).then((body) => body.diff),
    };
  },
  'automations/queries:getReplayPlan': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    const kind = args.kind;
    if (
      orgId === undefined ||
      typeof runId !== 'string' ||
      typeof kind !== 'string'
    ) {
      return null;
    }
    const params = new URLSearchParams({ kind });
    if (typeof args.from === 'string') params.set('from', args.from);
    if (typeof args.version === 'string' || typeof args.version === 'number') {
      params.set('version', String(args.version));
    }
    if (typeof args.mode === 'string') params.set('mode', args.mode);
    // Read when the replay dialog opens; a run's progress hint leaves it.
    return {
      queryKey: backendKey(
        orgId,
        'automation_replay_plan',
        runId,
        params.toString(),
      ),
      queryFn: () =>
        backendFetch<{ plan: ReplayPlanResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/replay?${params.toString()}`,
          { orgId },
        ).then((body) => body.plan),
    };
  },
  // Keyed under the run, so the run's own hint refreshes it: a decision
  // taken elsewhere, or the run moving on, clears the card everywhere.
  'automations/queries:getRunInDoubt': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    if (orgId === undefined || typeof runId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'automation_run', 'in-doubt', runId),
      queryFn: () =>
        backendFetch<{ inDoubt: RunInDoubtResult }>(
          `/automations/runs/${encodeURIComponent(runId)}/in-doubt`,
          { orgId },
        ).then((body) => body.inDoubt),
    };
  },
  'automations/queries:getOrgAutomationMetrics': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const periodDays =
      typeof args.periodDays === 'number' ? args.periodDays : 7;
    const mode = typeof args.mode === 'string' ? args.mode : '';
    return {
      queryKey: backendKey(
        orgId,
        'automation_run',
        'metrics',
        String(periodDays),
        mode,
      ),
      queryFn: () =>
        backendFetch<OrgAutomationMetricsResult>(
          `/automations/metrics?periodDays=${periodDays}${mode !== '' ? `&mode=${mode}` : ''}`,
          { orgId },
        ),
    };
  },
  'sandbox/session_queries_public:getAgentNodeSandboxOp': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const runId = args.runId;
    const nodeId = args.nodeId;
    if (nodeId !== undefined && typeof nodeId !== 'string') return null;
    if (orgId === undefined || typeof runId !== 'string' || runId === '') {
      return null;
    }
    return {
      queryKey: backendKey(
        orgId,
        'automation',
        'agent-node-op',
        runId,
        ...(typeof nodeId === 'string' ? [nodeId] : []),
      ),
      queryFn: () =>
        backendFetch<{ op: unknown }>(
          `/sandbox/agent-node-op?runId=${encodeURIComponent(runId)}${typeof nodeId === 'string' ? `&nodeId=${encodeURIComponent(nodeId)}` : ''}`,
          { orgId },
        ).then((body) => body.op),
      // The execution log follows a LIVE turn: poll while the dialog is
      // open (the WS lane pushed; the HTTP lane asks).
      refetchInterval: 2000,
    };
  },
  'approvals/queries:getApproval': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const approvalId = args.approvalId;
    if (orgId === undefined || typeof approvalId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'approval', 'detail', approvalId),
      queryFn: () =>
        backendFetch<ApprovalResult>(
          `/approvals/${encodeURIComponent(approvalId)}`,
          { orgId },
        ),
    };
  },
};

/** The node-type catalog, parsed at the boundary: an answer in a shape this
 * app does not read is a failed read (the editor then works from the core
 * types alone), never a cast. */
function readNodeTypeCatalog(body: unknown): NodeTypeCatalog {
  const parsed = nodeTypeCatalogSchema.safeParse(body);
  if (!parsed.success) {
    console.warn(
      '[automations] the node-type catalog answered in a shape this app does not read',
      parsed.error.issues,
    );
    throw new Error('The node-type catalog answered in an unreadable shape.');
  }
  return parsed.data;
}

/** pg run rows carry `id`; the 0.4 wire uses `_id`. */
function mapRunIds(rows: unknown[]): unknown[] {
  return rows.map((row) =>
    row !== null && typeof row === 'object' && 'id' in row
      ? { ...row, _id: row.id }
      : row,
  );
}

export const automationActionQueryAdapters: Record<string, ActionQueryAdapter> =
  {
    'automations/catalog:listNodeTypes': (args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return null;
      return () =>
        backendFetch<unknown>('/automations/catalog/node-types', {
          orgId,
        }).then(readNodeTypeCatalog);
    },
    'chat/composer:listAutomationCapabilities': (args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return null;
      const projectId =
        typeof args.projectId === 'string' ? args.projectId : '';
      return () =>
        backendFetch<AutomationCapabilitiesResult>(
          `/chat/composer/automation-capabilities${projectId !== '' ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
          { orgId },
        );
    },
  };

function invalidateAutomations(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'automation'),
  });
}

/**
 * What one run's hint refreshes: that run's own reads — its row, question,
 * write in doubt, record, open step and open pages — and the listings and
 * figures every run moves. Every read keyed under `automation_run` is
 * built in this file, so this is the whole of them.
 */
export function runHintPrefixes(
  orgId: string,
  runId: string,
): ReadonlyArray<readonly unknown[]> {
  return [
    backendKey(orgId, 'automation_run', 'list'),
    backendKey(orgId, 'automation_run', 'metrics'),
    ...(['detail', 'ask', 'in-doubt', 'record', 'node', 'items'] as const).map(
      (read) => backendKey(orgId, 'automation_run', read, runId),
    ),
  ];
}

function invalidateRuns(
  client: Parameters<NonNullable<WriteAdapter['invalidate']>>[0],
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) return;
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'automation_run'),
  });
}

export const automationWriteAdapters: Record<string, WriteAdapter> = {
  'automations/mutations:saveAutomation': {
    run: (args, ctx) => {
      const automation = args.automation;
      const name =
        automation !== null &&
        typeof automation === 'object' &&
        'name' in automation &&
        typeof automation.name === 'string'
          ? automation.name
          : '';
      return backendFetch<SaveAutomationResult>(
        `/automations/${namePath(name)}/save`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            document: args.automation,
            ...(typeof args.message === 'string'
              ? { message: args.message }
              : {}),
            ...(typeof args.testsPassed === 'boolean'
              ? { testsPassed: args.testsPassed }
              : {}),
            ...(args.taskContract !== undefined
              ? { taskContract: args.taskContract }
              : {}),
            ...(args.settings !== undefined ? { settings: args.settings } : {}),
            ...(args.presentation !== undefined
              ? { presentation: args.presentation }
              : {}),
            ...(typeof args.projectId === 'string'
              ? { projectId: args.projectId }
              : {}),
            // Create-only rides to the store — dropping it here is how a
            // colliding slug once silently appended a version to a live
            // automation instead of being refused.
            ...(args.create === true ? { create: true } : {}),
            // The version the draft started from — the store refuses the
            // save when another one landed since (409 AUTOMATION_VERSION_STALE).
            ...(typeof args.baseVersion === 'number'
              ? { baseVersion: args.baseVersion }
              : {}),
          },
        },
      );
    },
    invalidate: invalidateAutomations,
  },
  'automations/mutations:deployAutomation': {
    run: (args, ctx) =>
      backendFetch<DeployResult>(
        `/automations/${namePath(stringArg(args, 'name'))}/deploy`,
        {
          orgId: requireOrg(args, ctx),
          body: { version: args.version },
        },
      ),
    invalidate: invalidateAutomations,
  },
  'automations/mutations:setTrigger': {
    run: (args, ctx) => {
      const trigger =
        args.trigger !== null && typeof args.trigger === 'object'
          ? args.trigger
          : {};
      return backendFetch<SetTriggerResult>(
        `/automations/${namePath(stringArg(args, 'name'))}/trigger`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            ...trigger,
            ...(args.rotateToken === true ? { rotateToken: true } : {}),
          },
        },
      );
    },
    invalidate: invalidateAutomations,
  },
  'automations/mutations:deleteTrigger': {
    run: (args, ctx) =>
      backendFetch<{ deleted: boolean }>(
        `/automations/${namePath(stringArg(args, 'name'))}/trigger`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then(() => null),
    invalidate: invalidateAutomations,
  },
  'automations/mutations:setAutomationProjects': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/automations/${namePath(stringArg(args, 'name'))}/projects`,
        {
          orgId: requireOrg(args, ctx),
          body: { projectIds: args.projectIds ?? [] },
        },
      ).then(() => null),
    invalidate: invalidateAutomations,
  },
  'automations/mutations:deleteAutomation': {
    run: (args, ctx) =>
      backendFetch<{ deleted: boolean }>(
        `/automations/${namePath(stringArg(args, 'name'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then((): DeleteAutomationResult => ({
        name: stringArg(args, 'name'),
        versions: 0,
      })),
    invalidate: invalidateAutomations,
  },
  'automations/mutations:startRun': {
    run: (args, ctx) =>
      backendFetch<{ runId: string; version: number }>(
        `/automations/${namePath(stringArg(args, 'name'))}/start`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            ...(args.input !== undefined ? { input: args.input } : {}),
            ...(typeof args.mode === 'string' ? { mode: args.mode } : {}),
            ...(typeof args.version === 'number'
              ? { version: args.version }
              : {}),
            ...(typeof args.projectId === 'string'
              ? { projectId: args.projectId }
              : {}),
          },
        },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg run ids stand in for Convex ids on the 0.4 wire shape
      ).then((body) => body),
    invalidate: invalidateRuns,
  },
  'automations/mutations:cancelRun': {
    run: (args, ctx) =>
      backendFetch<CancelRunResult>(
        `/automations/runs/${encodeURIComponent(stringArg(args, 'runId'))}/cancel`,
        { orgId: requireOrg(args, ctx), body: {} },
      ),
    invalidate: invalidateRuns,
  },
  'automations/mutations:replayRun': {
    run: (args, ctx) => {
      const { organizationId: _org, runId: _run, ...request } = args;
      return backendFetch<ReplayRunResult>(
        `/automations/runs/${encodeURIComponent(stringArg(args, 'runId'))}/replay`,
        { orgId: requireOrg(args, ctx), body: request },
      );
    },
    invalidate: invalidateRuns,
  },
  'automations/mutations:requestLegacyRunStop': {
    run: (args, ctx) =>
      backendFetch<ReturnsOf<'automations/mutations:requestLegacyRunStop'>>(
        `/automations/runs/${encodeURIComponent(stringArg(args, 'runId'))}/legacy-quarantine`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            expectedClaimEpoch: args.expectedClaimEpoch,
            expectedObservedAt: args.expectedObservedAt,
            action: args.action,
            acknowledgeUnknownExternalEffects:
              args.acknowledgeUnknownExternalEffects,
          },
        },
      ),
    invalidate: invalidateRuns,
  },
  'automations/mutations:resolveRunInDoubt': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/automations/runs/${encodeURIComponent(stringArg(args, 'runId'))}/in-doubt/${encodeURIComponent(stringArg(args, 'attemptId'))}`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            resolution: stringArg(args, 'resolution'),
            attempt: attemptArg(args),
          },
        },
      ).then(() => null),
    invalidate: invalidateRuns,
  },
  'approvals/mutations:updateApprovalStatus': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/approvals/${encodeURIComponent(stringArg(args, 'approvalId'))}/decide`,
        {
          orgId: requireOrg(args, ctx),
          body: {
            status: stringArg(args, 'status'),
            ...(typeof args.comments === 'string'
              ? { comments: args.comments }
              : {}),
          },
        },
      ).then(() => null),
    invalidate: (client, args, ctx) => {
      invalidateRuns(client, args, ctx);
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      // The decided approval itself: its card reads the recorded decision
      // back without waiting for the approval hint.
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'approval'),
      });
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'gdpr_erasure'),
      });
    },
  },
  'automations/human_asks:answerAsk': {
    run: (args, ctx) =>
      backendFetch<{ ok: boolean }>(
        `/automations/asks/${encodeURIComponent(stringArg(args, 'askId'))}/answer`,
        {
          orgId: requireOrg(args, ctx),
          body: { answer: stringArg(args, 'answer') },
        },
      ).then(() => null),
    invalidate: invalidateRuns,
  },
  'automations/upload_mutations:generateAutomationUploadUrl': {
    // The pg byte lane IS the staging handshake: POST bytes → org blob ref.
    // The purpose scopes the upload intent the server records to the
    // automation bundle lane, which consumes it once.
    run: (args, ctx) =>
      Promise.resolve(
        backendUrl(
          '/files/upload?purpose=automation_bundle',
          requireOrg(args, ctx),
        ),
      ),
  },
  'automations/upload_mutations:recordAutomationUploadIntent': {
    // The byte lane records the intent server-side — nothing to add here.
    run: () => Promise.resolve(null),
  },
  'automations/upload_action:uploadAutomation': {
    run: (args, ctx) =>
      backendFetch<UploadAutomationResult>('/automations/upload', {
        orgId: requireOrg(args, ctx),
        body: {
          ...(typeof args.projectId === 'string'
            ? { projectId: args.projectId }
            : {}),
          ...(Array.isArray(args.files) ? { files: args.files } : {}),
          ...(typeof args.storageId === 'string'
            ? { storageId: args.storageId }
            : {}),
          ...(Array.isArray(args.overwriteSkills)
            ? { overwriteSkills: args.overwriteSkills }
            : {}),
        },
      }),
    invalidate: invalidateAutomations,
  },
};
