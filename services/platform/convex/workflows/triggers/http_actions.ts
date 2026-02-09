/**
 * Webhook HTTP handler for workflow triggers.
 * Endpoint: POST /api/workflows/wh/{token}
 *
 * Authentication: The unique token in the URL path acts as the credential.
 * No additional signature or API key is required.
 */

import type { Doc } from '../../_generated/dataModel';

import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { extractIdempotencyKey, extractClientIp } from './helpers/validate';

function jsonResponse(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const webhookHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    return jsonResponse({ error: 'Missing webhook token' }, 400);
  }

  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'workflow:webhook', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }
    throw error;
  }

  const webhook = (await ctx.runQuery(
    internal.workflows.triggers.internal_queries.getWebhookByToken,
    { token },
  )) as Doc<'wfWebhooks'> | null;

  if (!webhook) {
    return jsonResponse({ error: 'Invalid webhook token' }, 404);
  }

  if (!webhook.isActive) {
    return jsonResponse({ error: 'Webhook is disabled' }, 403);
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const idempotencyKey = extractIdempotencyKey(req.headers);
  if (idempotencyKey) {
    const existing = await ctx.runQuery(
      internal.workflows.triggers.internal_queries.checkIdempotencyQuery,
      { organizationId: webhook.organizationId, idempotencyKey },
    );
    if (existing) {
      return jsonResponse(
        {
          status: 'duplicate',
          executionId: existing.wfExecutionId,
        },
        200,
      );
    }
  }

  const activeVersionId = await ctx.runQuery(
    internal.workflows.triggers.internal_queries.getActiveVersion,
    { workflowRootId: webhook.workflowRootId },
  );

  if (!activeVersionId) {
    await ctx.runMutation(
      internal.workflows.triggers.internal_mutations.createTriggerLog,
      {
        organizationId: webhook.organizationId,
        workflowRootId: webhook.workflowRootId,
        wfDefinitionId: webhook.workflowRootId,
        triggerType: 'webhook',
        status: 'rejected',
        idempotencyKey: idempotencyKey ?? undefined,
        ipAddress: ip,
        errorMessage: 'No active workflow version',
      },
    );
    return jsonResponse({ error: 'No active workflow version' }, 404);
  }

  let payload: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload' }, 400);
    }
  }

  const executionId = await ctx.runMutation(
    internal.workflow_engine.internal_mutations.startWorkflow,
    {
      organizationId: webhook.organizationId,
      wfDefinitionId: activeVersionId,
      input: payload,
      triggeredBy: 'webhook',
      triggerData: {
        triggerType: 'webhook',
        webhookId: webhook._id,
        token: webhook.token,
        timestamp: Date.now(),
      },
    },
  );

  await ctx.runMutation(
    internal.workflows.triggers.internal_mutations.createTriggerLog,
    {
      organizationId: webhook.organizationId,
      workflowRootId: webhook.workflowRootId,
      wfDefinitionId: activeVersionId,
      wfExecutionId: executionId,
      triggerType: 'webhook',
      status: 'accepted',
      idempotencyKey: idempotencyKey ?? undefined,
      ipAddress: ip,
    },
  );

  await ctx.runMutation(
    internal.workflows.triggers.internal_mutations.updateWebhookLastTriggered,
    { webhookId: webhook._id, lastTriggeredAt: Date.now() },
  );

  return jsonResponse(
    {
      status: 'accepted',
      executionId,
      workflowRootId: webhook.workflowRootId,
      versionId: activeVersionId,
    },
    200,
  );
});

export const webhookOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Idempotency-Key',
    },
  });
});
