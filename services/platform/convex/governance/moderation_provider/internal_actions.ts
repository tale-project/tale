'use node';

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import {
  callModeration,
  isCircuitOpen,
  ModerationHttpError,
  recordCircuitFailure,
  recordCircuitSuccess,
} from './http_client';
import { parseResponse, ParseError } from './response_parser';
import { resolveModerationAuthHeader } from './secrets';

/**
 * Node-runtime boundary for the external moderation HTTP call.
 *
 * The V8 `sanitize.ts` dispatcher invokes this via `ctx.runAction(...)`
 * rather than importing the function directly, because the SOPS CLI
 * (`resolveModerationSecrets`) and `safeFetch`'s Node filesystem /
 * crypto internals can't be bundled into the V8 runtime.
 *
 * Returns a serialized outcome shape matching `FilterOutcome` with an
 * additional `extras` payload used by audit. Never throws — failure
 * modes map to `step_error` kind and the caller decides what to do
 * based on `failBehavior`.
 */

const outcomeKindValidator = v.union(
  v.literal('pass'),
  v.literal('modified'),
  v.literal('flagged'),
  v.literal('blocked'),
  v.literal('step_error'),
);

const errorClassValidator = v.union(
  v.literal('timeout'),
  v.literal('network'),
  v.literal('parse'),
  v.literal('http_4xx'),
  v.literal('http_5xx'),
  v.literal('config'),
  v.literal('unknown'),
);

const directionValidator = v.union(v.literal('input'), v.literal('output'));

const responseShapeValidator = v.union(
  v.object({ type: v.literal('openai_moderation') }),
  v.object({ type: v.literal('azure_content_safety') }),
  v.object({ type: v.literal('perspective') }),
  v.object({
    type: v.literal('custom_jsonpath'),
    flaggedPath: v.optional(v.string()),
    categoriesPath: v.string(),
    scoresPath: v.optional(v.string()),
    categoryShape: v.union(
      v.literal('array'),
      v.literal('record_of_bool'),
      v.literal('record_of_score'),
    ),
  }),
);

const categoryMappingValidator = v.object({
  providerCategory: v.string(),
  internalLabel: v.string(),
  enabled: v.boolean(),
  mode: v.union(v.literal('block'), v.literal('mask'), v.literal('flag')),
  scoreThreshold: v.optional(v.number()),
});

const bufferPolicyValidator = v.object({
  minFlushChars: v.number(),
  maxBufferChars: v.number(),
  idleFlushMs: v.number(),
  perStreamMaxConcurrent: v.number(),
});

const endpointValidator = v.object({
  url: v.string(),
  method: v.literal('POST'),
  headers: v.record(v.string(), v.string()),
  requestTemplate: v.string(),
  timeoutMs: v.number(),
  maxResponseBytes: v.number(),
  bufferPolicy: bufferPolicyValidator,
});

function resolveMappings(
  categories: Record<string, { flagged: boolean; score?: number }>,
  mappings: ReadonlyArray<{
    providerCategory: string;
    internalLabel: string;
    enabled: boolean;
    mode: 'block' | 'mask' | 'flag';
    scoreThreshold?: number;
  }>,
): {
  triggeredBlock: string[];
  triggeredMask: string[];
  triggeredFlag: string[];
} {
  const triggeredBlock: string[] = [];
  const triggeredMask: string[] = [];
  const triggeredFlag: string[] = [];

  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    const providerResult = categories[mapping.providerCategory];
    if (!providerResult) continue;

    const meetsThreshold =
      mapping.scoreThreshold === undefined
        ? providerResult.flagged
        : providerResult.score !== undefined &&
          providerResult.score >= mapping.scoreThreshold;

    if (!meetsThreshold) continue;

    if (mapping.mode === 'block') triggeredBlock.push(mapping.internalLabel);
    else if (mapping.mode === 'mask') triggeredMask.push(mapping.internalLabel);
    else triggeredFlag.push(mapping.internalLabel);
  }

  return { triggeredBlock, triggeredMask, triggeredFlag };
}

export const runModerationProviderAction = internalAction({
  args: {
    organizationId: v.string(),
    orgSlug: v.string(),
    direction: directionValidator,
    text: v.string(),
    endpoint: endpointValidator,
    responseShape: responseShapeValidator,
    categoryMappings: v.array(categoryMappingValidator),
    failBehavior: v.object({
      input: v.union(v.literal('open'), v.literal('closed')),
      output: v.union(v.literal('open'), v.literal('closed')),
    }),
  },
  returns: v.object({
    outcome: v.object({
      kind: outcomeKindValidator,
      categoryIds: v.optional(v.array(v.string())),
      matchCount: v.optional(v.number()),
      text: v.optional(v.string()),
      errorClass: v.optional(errorClassValidator),
    }),
    extras: v.object({
      httpStatus: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      errorClass: v.optional(errorClassValidator),
      attempts: v.optional(v.number()),
      circuitOpened: v.optional(v.boolean()),
    }),
  }),
  handler: async (ctx, args) => {
    const failMode = args.failBehavior[args.direction];

    const stepError = (extras: {
      errorClass?:
        | 'timeout'
        | 'network'
        | 'parse'
        | 'http_4xx'
        | 'http_5xx'
        | 'config'
        | 'unknown';
      httpStatus?: number;
      durationMs?: number;
      attempts?: number;
      circuitOpened?: boolean;
    }) => {
      if (failMode === 'closed') {
        return {
          outcome: {
            kind: 'blocked' as const,
            categoryIds: ['moderation_unavailable'],
            matchCount: 0,
          },
          extras,
        };
      }
      return {
        outcome: {
          kind: 'step_error' as const,
          errorClass: extras.errorClass ?? 'unknown',
        },
        extras,
      };
    };

    if (isCircuitOpen(args.organizationId, args.direction)) {
      return stepError({ errorClass: 'unknown', circuitOpened: true });
    }

    let authHeader: string | null = null;
    try {
      authHeader = await resolveModerationAuthHeader(ctx, args.organizationId);
    } catch (err) {
      console.warn(
        `[moderation_provider] failed to resolve secret for org ${args.organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const requiresSecret = Object.values(args.endpoint.headers).some((v2) =>
      v2.includes('{{secret}}'),
    );
    if (requiresSecret && !authHeader) {
      const justOpened = recordCircuitFailure(
        args.organizationId,
        args.direction,
      ).justOpened;
      return stepError({
        errorClass: 'config',
        circuitOpened: justOpened,
      });
    }

    let callResult;
    try {
      callResult = await callModeration({
        endpoint: args.endpoint,
        text: args.text,
        direction: args.direction,
        authHeader,
      });
    } catch (err) {
      if (err instanceof ModerationHttpError) {
        const justOpened = recordCircuitFailure(
          args.organizationId,
          args.direction,
        ).justOpened;
        return stepError({
          errorClass: err.errorClass,
          httpStatus: err.httpStatus,
          durationMs: err.durationMs,
          attempts: err.attempts,
          circuitOpened: justOpened,
        });
      }
      const justOpened = recordCircuitFailure(
        args.organizationId,
        args.direction,
      ).justOpened;
      return stepError({
        errorClass: 'unknown',
        circuitOpened: justOpened,
      });
    }

    let normalized;
    try {
      normalized = parseResponse(callResult.body, args.responseShape);
    } catch (err) {
      if (err instanceof ParseError) {
        const justOpened = recordCircuitFailure(
          args.organizationId,
          args.direction,
        ).justOpened;
        return stepError({
          errorClass: 'parse',
          durationMs: callResult.durationMs,
          attempts: callResult.attempts,
          circuitOpened: justOpened,
        });
      }
      throw err;
    }

    recordCircuitSuccess(args.organizationId, args.direction);

    const { triggeredBlock, triggeredMask, triggeredFlag } = resolveMappings(
      normalized.categories,
      args.categoryMappings,
    );

    const totalHits =
      triggeredBlock.length + triggeredMask.length + triggeredFlag.length;

    const extras: {
      httpStatus?: number;
      durationMs?: number;
      attempts?: number;
      circuitOpened?: boolean;
      errorClass?:
        | 'timeout'
        | 'network'
        | 'parse'
        | 'http_4xx'
        | 'http_5xx'
        | 'config'
        | 'unknown';
    } = {
      httpStatus: callResult.status,
      durationMs: callResult.durationMs,
      attempts: callResult.attempts,
    };

    if (triggeredBlock.length > 0) {
      return {
        outcome: {
          kind: 'blocked' as const,
          categoryIds: triggeredBlock,
          matchCount: totalHits,
        },
        extras,
      };
    }
    if (triggeredMask.length > 0) {
      return {
        outcome: {
          kind: 'flagged' as const,
          categoryIds: [...triggeredMask, ...triggeredFlag],
          matchCount: totalHits,
        },
        extras,
      };
    }
    if (triggeredFlag.length > 0) {
      return {
        outcome: {
          kind: 'flagged' as const,
          categoryIds: triggeredFlag,
          matchCount: totalHits,
        },
        extras,
      };
    }
    return { outcome: { kind: 'pass' as const }, extras };
  },
});
