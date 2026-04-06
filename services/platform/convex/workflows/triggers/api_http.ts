/**
 * API Trigger HTTP handler for workflow triggers.
 * Endpoint: POST /api/workflows/trigger
 * Authorization: Bearer wfk_xxx...
 */

import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { hashSecret } from './helpers/crypto';
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
    return jsonResponse(
      { error: 'Missing or invalid Authorization header' },
      401,
    );
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();
  if (!apiKey.startsWith('wfk_')) {
    return jsonResponse({ error: 'Invalid API key format' }, 401);
  }

  // Look up API key by hash
  const keyHash = await hashSecret(apiKey);
  const apiKeyRecord = await ctx.runQuery(
    internal.workflows.triggers.internal_queries.getApiKeyByHash,
    { keyHash },
  );

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
  let body: {
    workflowRootId?: string;
    input?: Record<string, unknown>;
    idempotencyKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Check idempotency
  const idempotencyKey =
    body.idempotencyKey || extractIdempotencyKey(req.headers);
  if (idempotencyKey) {
    const existing = await ctx.runQuery(
      internal.workflows.triggers.internal_queries.checkIdempotencyQuery,
      { organizationId: apiKeyRecord.organizationId, idempotencyKey },
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

  if (apiKeyRecord.workflowSlug) {
    await ctx.scheduler.runAfter(
      0,
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: apiKeyRecord.organizationId,
        orgSlug: 'default',
        workflowSlug: apiKeyRecord.workflowSlug,
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

    await ctx.runMutation(
      internal.workflows.triggers.internal_mutations.createTriggerLog,
      {
        organizationId: apiKeyRecord.organizationId,
        workflowRootId: apiKeyRecord.workflowRootId,
        workflowSlug: apiKeyRecord.workflowSlug,
        triggerType: 'api',
        status: 'accepted',
        idempotencyKey: idempotencyKey ?? undefined,
        ipAddress: ip,
      },
    );

    return jsonResponse(
      {
        status: 'accepted',
        workflowSlug: apiKeyRecord.workflowSlug,
      },
      202,
    );
  }

  return jsonResponse(
    { error: 'API key has no workflow slug configured' },
    404,
  );
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
