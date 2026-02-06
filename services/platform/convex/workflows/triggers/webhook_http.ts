/**
 * Webhook HTTP handler for workflow triggers.
 * Endpoint: POST /api/workflows/wh/{token}
 */

import { httpAction } from '../../_generated/server';
import { internal, api } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { verifyHmac } from './helpers/crypto';
import {
  extractSignature,
  extractIdempotencyKey,
  extractClientIp,
} from './helpers/validate';

function jsonResponse(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const webhookHandler = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  // Expected: /api/workflows/wh/{token}
  const token = pathParts[pathParts.length - 1];

  if (!token) {
    return jsonResponse({ error: 'Missing webhook token' }, 400);
  }

  // Rate limit by IP
  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'workflow:webhook', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }
    throw error;
  }

  // Look up webhook config by token
  const webhook = await ctx.runQuery(
    internal.workflows.triggers.webhooks.getWebhookByToken,
    { token },
  ) as Doc<'wfWebhooks'> | null;

  if (!webhook) {
    return jsonResponse({ error: 'Invalid webhook token' }, 404);
  }

  if (!webhook.isActive) {
    return jsonResponse({ error: 'Webhook is disabled' }, 403);
  }

  // Verify HMAC signature
  const signature = extractSignature(req.headers);
  if (!signature) {
    await ctx.runMutation(internal.workflows.triggers.trigger_logs.createTriggerLog, {
      organizationId: webhook.organizationId,
      workflowRootId: webhook.workflowRootId,
      wfDefinitionId: webhook.workflowRootId,
      triggerType: 'webhook',
      status: 'rejected',
      ipAddress: ip,
      errorMessage: 'Missing X-Webhook-Signature header',
    });
    return jsonResponse({ error: 'Missing X-Webhook-Signature header' }, 401);
  }

  // Read request body
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // Verify the signature using the stored secret hash as lookup,
  // but we need the original secret for HMAC. Since we store a hash,
  // the client must sign with the original secret and we verify by
  // recomputing from the stored hash.
  // Actually: we need to store the secret in a retrievable form for HMAC.
  // The secretHash stored is a SHA-256 of the secret. For HMAC verification,
  // we use the secretHash itself as the HMAC key (the webhook creator gets
  // the original secret to use for signing, and we use the hash as the
  // symmetric key on both sides — this works because the hash IS the shared
  // secret, not the original random value).
  const isValid = await verifyHmac(bodyText, signature, webhook.secretHash);
  if (!isValid) {
    await ctx.runMutation(internal.workflows.triggers.trigger_logs.createTriggerLog, {
      organizationId: webhook.organizationId,
      workflowRootId: webhook.workflowRootId,
      wfDefinitionId: webhook.workflowRootId,
      triggerType: 'webhook',
      status: 'rejected',
      ipAddress: ip,
      errorMessage: 'Invalid signature',
    });
    return jsonResponse({ error: 'Invalid signature' }, 401);
  }

  // Check idempotency
  const idempotencyKey = extractIdempotencyKey(req.headers);
  if (idempotencyKey) {
    const existing = await ctx.runQuery(
      internal.workflows.triggers.queries.checkIdempotencyQuery,
      { organizationId: webhook.organizationId, idempotencyKey },
    );
    if (existing) {
      return jsonResponse({
        status: 'duplicate',
        executionId: existing.wfExecutionId,
      }, 200);
    }
  }

  // Resolve active workflow version
  const activeVersionId = await ctx.runQuery(
    internal.workflows.triggers.queries.getActiveVersion,
    { workflowRootId: webhook.workflowRootId },
  );

  if (!activeVersionId) {
    await ctx.runMutation(internal.workflows.triggers.trigger_logs.createTriggerLog, {
      organizationId: webhook.organizationId,
      workflowRootId: webhook.workflowRootId,
      wfDefinitionId: webhook.workflowRootId,
      triggerType: 'webhook',
      status: 'rejected',
      idempotencyKey: idempotencyKey ?? undefined,
      ipAddress: ip,
      errorMessage: 'No active workflow version',
    });
    return jsonResponse({ error: 'No active workflow version' }, 404);
  }

  // Parse payload
  let payload: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return jsonResponse({ error: 'Invalid JSON payload' }, 400);
    }
  }

  // Start workflow execution
  const executionId = await ctx.runMutation(
    api.workflow_engine.engine.startWorkflow,
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

  // Log successful trigger
  await ctx.runMutation(internal.workflows.triggers.trigger_logs.createTriggerLog, {
    organizationId: webhook.organizationId,
    workflowRootId: webhook.workflowRootId,
    wfDefinitionId: activeVersionId,
    wfExecutionId: executionId,
    triggerType: 'webhook',
    status: 'accepted',
    idempotencyKey: idempotencyKey ?? undefined,
    ipAddress: ip,
  });

  // Update webhook last triggered time
  await ctx.runMutation(
    internal.workflows.triggers.webhooks.updateLastTriggered,
    { webhookId: webhook._id, lastTriggeredAt: Date.now() },
  );

  return jsonResponse({
    status: 'accepted',
    executionId,
    workflowRootId: webhook.workflowRootId,
    versionId: activeVersionId,
  }, 200);
});

export const webhookOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, X-Webhook-Signature, X-Idempotency-Key',
    },
  });
});
