/**
 * Workflows REST API handlers.
 *
 * Triggers:
 *   GET    /api/v1/workflows/:slug/schedules   — List schedules
 *   POST   /api/v1/workflows/:slug/schedules   — Create schedule
 *   GET    /api/v1/workflows/:slug/webhooks    — List webhooks
 *   POST   /api/v1/workflows/:slug/webhooks    — Create webhook
 *   GET    /api/v1/workflows/:slug/logs        — Get trigger logs
 *   POST   /api/v1/workflows/:slug/run         — Trigger workflow manually
 *
 * Trigger resources:
 *   PATCH  /api/v1/workflows/schedules/:id     — Update schedule
 *   DELETE /api/v1/workflows/schedules/:id     — Delete schedule
 *   DELETE /api/v1/workflows/webhooks/:id      — Delete webhook
 *
 * Executions:
 *   GET    /api/v1/workflows/:slug/executions          — List executions
 *   GET    /api/v1/workflows/executions/:id             — Get execution details
 *   POST   /api/v1/workflows/executions/:id/cancel      — Cancel execution
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonNoContent,
  jsonOk,
  parseIntParam,
  withRestAuth,
} from '../lib/rest/helpers';
import { toId } from '../lib/type_cast_helpers';

const PREFIX = '/api/v1/workflows/';

// ---------------------------------------------------------------------------
// GET /api/v1/workflows/* (pathPrefix handler)
// ---------------------------------------------------------------------------

export const getWorkflow = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: firstSegment, subPath } = extractPathParts(url, PREFIX);

  if (!firstSegment) {
    return jsonError('Missing workflow slug or resource type', 400);
  }

  // GET /api/v1/workflows/executions/:id — get execution details
  if (firstSegment === 'executions' && subPath) {
    const executionId = subPath.split('/')[0];
    const execution = await rc.ctx.runQuery(
      internal.wf_executions.internal_queries.getExecutionStepJournalInternal,
      {
        executionId: toId<'wfExecutions'>(executionId),
        callerOrgId: rc.org.organizationId,
      },
    );
    if (!execution) {
      return jsonError('Execution not found', 404);
    }
    return jsonOk(execution);
  }

  // Remaining routes are /api/v1/workflows/:slug/:resource
  const slug = firstSegment;
  const resource = subPath?.split('/')[0];

  if (resource === 'schedules') {
    const schedules = await rc.ctx.runQuery(
      internal.workflows.triggers.internal_queries.getSchedulesBySlugInternal,
      {
        organizationId: rc.org.organizationId,
        workflowSlug: slug,
      },
    );
    return jsonOk(schedules);
  }

  if (resource === 'webhooks') {
    const webhooks = await rc.ctx.runQuery(
      internal.workflows.triggers.internal_queries.getWebhooksBySlugInternal,
      {
        organizationId: rc.org.organizationId,
        workflowSlug: slug,
      },
    );
    return jsonOk(webhooks);
  }

  if (resource === 'logs') {
    const logs = await rc.ctx.runQuery(
      internal.workflows.triggers.internal_queries.getTriggerLogsBySlugInternal,
      {
        organizationId: rc.org.organizationId,
        workflowSlug: slug,
      },
    );
    return jsonOk(logs);
  }

  if (resource === 'executions') {
    const cursor = url.searchParams.get('cursor') ?? null;
    const numItems = parseIntParam(url, 'limit', 25);
    const statusParam = url.searchParams.get('status');
    const status = statusParam ? statusParam.split(',') : undefined;
    const dateFrom = url.searchParams.get('dateFrom') ?? undefined;
    const dateTo = url.searchParams.get('dateTo') ?? undefined;

    const executions = await rc.ctx.runQuery(
      internal.wf_executions.internal_queries.listExecutionsCursorInternal,
      {
        wfDefinitionId: slug,
        cursor,
        numItems,
        status,
        dateFrom,
        dateTo,
        callerOrgId: rc.org.organizationId,
      },
    );
    return jsonOk(executions);
  }

  return jsonError(`Unknown resource: ${resource}`, 404);
});

// ---------------------------------------------------------------------------
// POST /api/v1/workflows/* (pathPrefix handler)
// ---------------------------------------------------------------------------

export const postWorkflow = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: firstSegment, subPath } = extractPathParts(url, PREFIX);

  if (!firstSegment) {
    return jsonError('Missing workflow slug or resource type', 400);
  }

  // POST /api/v1/workflows/executions/:id/cancel
  if (firstSegment === 'executions' && subPath) {
    const parts = subPath.split('/');
    const executionId = parts[0];
    const action = parts[1];

    if (action === 'cancel') {
      await rc.ctx.runMutation(
        internal.workflows.triggers.internal_mutations.cancelExecutionInternal,
        {
          executionId: toId<'wfExecutions'>(executionId),
          callerOrgId: rc.org.organizationId,
        },
      );
      return jsonOk({ status: 'canceled' });
    }

    return jsonError(`Unknown action: ${action}`, 404);
  }

  // Remaining routes are /api/v1/workflows/:slug/:resource
  const slug = firstSegment;
  const resource = subPath?.split('/')[0];

  if (resource === 'schedules') {
    const body = await request.json();

    const workflowRead = await rc.ctx.runAction(
      internal.workflows.file_actions.readWorkflowForExecution,
      { orgSlug: rc.org.orgSlug, workflowSlug: slug },
    );
    const requires = workflowRead.ok ? workflowRead.config.requires : undefined;

    const scheduleId = await rc.ctx.runMutation(
      internal.workflows.triggers.internal_mutations.createScheduleInternal,
      {
        organizationId: rc.org.organizationId,
        workflowSlug: slug,
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        createdBy: rc.user.email,
        variables: body.variables,
        requires,
      },
    );
    return jsonCreated({ id: scheduleId });
  }

  if (resource === 'webhooks') {
    const result = await rc.ctx.runMutation(
      internal.workflows.triggers.internal_mutations.createWebhookInternal,
      {
        organizationId: rc.org.organizationId,
        workflowSlug: slug,
        createdBy: rc.user.email,
      },
    );
    return jsonCreated({ id: result._id, token: result.token });
  }

  if (resource === 'run') {
    const body = await request.json();
    const executionId = await rc.ctx.runAction(
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: rc.org.organizationId,
        orgSlug: rc.org.orgSlug,
        workflowSlug: slug,
        input: body.input,
        triggeredBy: 'api',
        triggerData: body.triggerData,
        userId: rc.user.userId,
      },
    );
    return jsonOk({ status: 'accepted', executionId });
  }

  return jsonError(`Unknown resource: ${resource}`, 404);
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/workflows/* (pathPrefix handler)
// ---------------------------------------------------------------------------

export const patchWorkflow = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: resourceType, subPath } = extractPathParts(url, PREFIX);

  if (resourceType === 'schedules' && subPath) {
    const scheduleId = subPath.split('/')[0];
    const body = await request.json();
    await rc.ctx.runMutation(
      internal.workflows.triggers.internal_mutations.updateScheduleInternal,
      {
        scheduleId: toId<'wfSchedules'>(scheduleId),
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        isActive: body.isActive,
        variables: body.variables,
        callerOrgId: rc.org.organizationId,
      },
    );
    return jsonNoContent();
  }

  return jsonError('Unknown resource', 404);
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/workflows/* (pathPrefix handler)
// ---------------------------------------------------------------------------

export const deleteWorkflow = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: resourceType, subPath } = extractPathParts(url, PREFIX);

  if (resourceType === 'schedules' && subPath) {
    const scheduleId = subPath.split('/')[0];
    await rc.ctx.runMutation(
      internal.workflows.triggers.internal_mutations.deleteScheduleInternal,
      {
        scheduleId: toId<'wfSchedules'>(scheduleId),
        callerOrgId: rc.org.organizationId,
      },
    );
    return jsonNoContent();
  }

  if (resourceType === 'webhooks' && subPath) {
    const webhookId = subPath.split('/')[0];
    await rc.ctx.runMutation(
      internal.workflows.triggers.internal_mutations.deleteWebhookInternal,
      {
        webhookId: toId<'wfWebhooks'>(webhookId),
        callerOrgId: rc.org.organizationId,
      },
    );
    return jsonNoContent();
  }

  return jsonError('Unknown resource', 404);
});
