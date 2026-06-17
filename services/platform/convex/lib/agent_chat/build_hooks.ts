'use node';

import type { FunctionHandle } from 'convex/server';

import type {
  GenerateResponseHooks,
  BeforeContextResult,
  BeforeGenerateResult,
} from '../agent_response/types';

/**
 * Build hooks object from FunctionHandle configuration.
 * Converts string handles to callable functions.
 */
export function buildHooksFromConfig(hooksConfig: {
  beforeContext?: string;
  beforeGenerate?: string;
  afterGenerate?: string;
}): GenerateResponseHooks {
  const hooks: GenerateResponseHooks = {};

  if (hooksConfig.beforeContext) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.beforeContext as unknown as FunctionHandle<'action'>;
    hooks.beforeContext = async (ctx, args) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        userId: args.userId,
        promptMessage: args.promptMessage,
        organizationId: args.organizationId,
      });
      // runAction returns unknown; we trust the hook contract
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- hook return type guaranteed by contract
      return result as BeforeContextResult;
    };
  }

  if (hooksConfig.beforeGenerate) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.beforeGenerate as unknown as FunctionHandle<'action'>;
    hooks.beforeGenerate = async (ctx, args, context, _hookData) => {
      const result = await ctx.runAction(handle, {
        threadId: args.threadId,
        promptMessage: args.promptMessage,
        attachments: args.attachments,
        contextMessagesTokens: context.stats.totalTokens,
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- hook return type guaranteed by contract
      return result as BeforeGenerateResult;
    };
  }

  if (hooksConfig.afterGenerate) {
    const handle =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex stores FunctionHandle as string; branded type requires assertion
      hooksConfig.afterGenerate as unknown as FunctionHandle<'action'>;
    hooks.afterGenerate = async (ctx, args, result, _hookData) => {
      await ctx.runAction(handle, {
        threadId: args.threadId,
        result: {
          text: result.text,
          usage: result.usage,
          durationMs: result.durationMs,
        },
      });
    };
  }

  return hooks;
}
