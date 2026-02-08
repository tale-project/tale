/**
 * API Trigger HTTP handler for workflow triggers.
 * Endpoint: POST /api/workflows/trigger
 * Authorization: Bearer wfk_xxx...
 */

import { httpAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { hashSecret } from './helpers/crypto';
import {
  extractIdempotencyKey,
  extractClientIp,
} from './helpers/validate';

function jsonResponse(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const apiTriggerHandler = httpAction(async (ctx, req) => {
  // Rate limit by IP
  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'workflow:api', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }
    throw error;
  }

  // Extract API key from Authorization header
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const apiKey = authHeader.substring('Bearer '.length).trim();
  if (!apiKey.startsWith('wfk_')) {
    return jsonResponse({ error: 'Invalid API key format' }, 401);
  }

  // Look up API key by hash
  const keyHash = await hashSecret(apiKey);
  const apiKeyRecord = await ctx.runQuery(
    internal.workflows.triggers.internal_queries.getApiKeyByHash,
    { keyHash },
  ) as Doc<'wfApiKeys'> | null;

  if (!apiKeyRecord) {
    return jsonResponse({ error: 'Invalid API key' }, 401);
  }

  if (!apiKeyRecord.isActive) {
    return jsonResponse({ error: 'API key is revoked' }, 403);
  }

  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < Date.now()) {
    return jsonResponse({ error: 'API key has expired' }, 403);
  }

  // Parse request body
  let body: { workflowRootId?: string; input?: Record<string, unknown>; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Validate workflowRootId matches the API key
  const workflowRootId = body.workflowRootId || apiKeyRecord.workflowRootId;
  if (workflowRootId !== apiKeyRecord.workflowRootId) {
    await ctx.runMutation(internal.workflows.triggers.internal_mutations.createTriggerLog, {
      organizationId: apiKeyRecord.organizationId,
      workflowRootId: apiKeyRecord.workflowRootId,
      wfDefinitionId: apiKeyRecord.workflowRootId,
      triggerType: 'api',
      status: 'rejected',
      ipAddress: ip,
      errorMessage: 'API key does not match specified workflowRootId',
    });
    return jsonResponse({ error: 'API key does not belong to the specified workflow' }, 403);
  }

  // Check idempotency
  const idempotencyKey = body.idempotencyKey || extractIdempotencyKey(req.headers);
  if (idempotencyKey) {
    const existing = await ctx.runQuery(
      internal.workflows.triggers.internal_queries.checkIdempotencyQuery,
      { organizationId: apiKeyRecord.organizationId, idempotencyKey },
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
    internal.workflows.triggers.internal_queries.getActiveVersion,
    { workflowRootId: apiKeyRecord.workflowRootId },
  );

  if (!activeVersionId) {
    await ctx.runMutation(internal.workflows.triggers.internal_mutations.createTriggerLog, {
      organizationId: apiKeyRecord.organizationId,
      workflowRootId: apiKeyRecord.workflowRootId,
      wfDefinitionId: apiKeyRecord.workflowRootId,
      triggerType: 'api',
      status: 'rejected',
      idempotencyKey: idempotencyKey ?? undefined,
      ipAddress: ip,
      errorMessage: 'No active workflow version',
    });
    return jsonResponse({ error: 'No active workflow version' }, 404);
  }

  // Start workflow execution
  const executionId = await ctx.runMutation(
    internal.workflow_engine.internal_mutations.startWorkflow,
    {
      organizationId: apiKeyRecord.organizationId,
      wfDefinitionId: activeVersionId,
      input: body.input ?? {},
      triggeredBy: 'api',
      triggerData: {
        triggerType: 'api',
        apiKeyId: apiKeyRecord._id,
        apiKeyName: apiKeyRecord.name,
        timestamp: Date.now(),
      },
    },
  );

  // Log successful trigger
  await ctx.runMutation(internal.workflows.triggers.internal_mutations.createTriggerLog, {
    organizationId: apiKeyRecord.organizationId,
    workflowRootId: apiKeyRecord.workflowRootId,
    wfDefinitionId: activeVersionId,
    wfExecutionId: executionId,
    triggerType: 'api',
    status: 'accepted',
    idempotencyKey: idempotencyKey ?? undefined,
    ipAddress: ip,
  });

  return jsonResponse({
    status: 'accepted',
    executionId,
    workflowRootId: apiKeyRecord.workflowRootId,
    versionId: activeVersionId,
  }, 200);
});

export const apiTriggerOptionsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Idempotency-Key',
    },
  });
});
