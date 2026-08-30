/**
 * Automations vertical over the 0.5 backend — the editor, the run log, the
 * triggers/projects bindings, the metrics page, the node-type catalog, and
 * the package-upload lane. The store server landed in the automations
 * module increments; this file is the adapter rows (plus the two already
 * living in `tasks.ts`/`projects.ts`: `getLiveRunForTask`,
 * `listAutomations`). Response types are DERIVED from the 0.4 signatures.
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

import { backendFetch, backendUrl } from './api-client';
import type {
  ActionQueryAdapter,
  AdapterContext,
  ReadAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

type GetAutomationResult = ReturnsOf<'automations/queries:getAutomation'>;
type ListVersionsResult = ReturnsOf<'automations/queries:listVersions'>;
type ListTriggersResult = ReturnsOf<'automations/queries:listTriggers'>;
type ListRunsResult = ReturnsOf<'automations/queries:listRuns'>;
type GetRunResult = ReturnsOf<'automations/queries:getRun'>;
type PendingAskResult = ReturnsOf<'automations/human_asks:getPendingAskForRun'>;
type OrgAutomationMetricsResult =
  ReturnsOf<'automations/queries:getOrgAutomationMetrics'>;
type ApprovalResult = ReturnsOf<'approvals/queries:getApproval'>;
type NodeTypesResult = ReturnsOf<'automations/catalog:listNodeTypes'>;
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

/** Automation names are '/'-separated paths — encode per segment. */
function namePath(name: string): string {
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
            ({ ...body.run, _id: body.run.id }) as unknown as GetRunResult,
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
    if (orgId === undefined || typeof runId !== 'string' || runId === '') {
      return null;
    }
    return {
      queryKey: backendKey(orgId, 'automation', 'agent-node-op', runId),
      queryFn: () =>
        backendFetch<{ op: unknown }>(
          `/sandbox/agent-node-op?runId=${encodeURIComponent(runId)}`,
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
        backendFetch<{ nodeTypes: NodeTypesResult }>(
          '/automations/catalog/node-types',
          { orgId },
        ).then((body) => body.nodeTypes);
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
    invalidate: invalidateRuns,
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
    run: (args, ctx) =>
      Promise.resolve(backendUrl('/files/upload', requireOrg(args, ctx))),
  },
  'automations/upload_mutations:recordAutomationUploadIntent': {
    // Ownership rides the org-prefixed key — nothing to record on pg.
    run: () => Promise.resolve(null),
  },
  'automations_builder/actions:startBuilderSession': {
    // A session spans minutes of model turns; the route holds the request
    // open exactly as the 0.4 action did.
    run: (args, ctx) =>
      backendFetch<unknown>('/automations/builder/sessions', {
        orgId: requireOrg(args, ctx),
        body: {
          goal: stringArg(args, 'goal'),
          model: args.model,
          ...(typeof args.projectId === 'string'
            ? { projectId: args.projectId }
            : {}),
          ...(typeof args.maxTurns === 'number'
            ? { maxTurns: args.maxTurns }
            : {}),
        },
      }),
    invalidate: invalidateAutomations,
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
