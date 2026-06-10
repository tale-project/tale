import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';

import { components } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { reasoningProviderOptionsFor } from '../lib/agent_response/reasoning/build_reasoning_options';
import { renderPrompt } from '../lib/prompts/registry';
import { buildCallProviderOptions } from '../lib/provider_options';
import type { ResolvedModelData } from '../providers/resolve_model';

function createImproveMessageAgent(
  languageModel: LanguageModelV3,
  instruction?: string,
) {
  return new Agent(components.agent, {
    name: 'message-improver',
    languageModel,
    instructions: renderPrompt('improve_message.base', {
      instructionLine: instruction
        ? `Additional instruction: ${instruction}`
        : '',
    }),
  });
}

export async function improveMessage(
  ctx: ActionCtx,
  args: {
    originalMessage: string;
    instruction?: string;
    languageModel: LanguageModelV3;
    modelData?: ResolvedModelData;
  },
): Promise<{ improvedMessage: string; error?: string }> {
  try {
    const agent = createImproveMessageAgent(
      args.languageModel,
      args.instruction,
    );
    // Mechanical rewrite — force minimal reasoning on reasoning-capable models.
    const callProviderOptions = args.modelData
      ? reasoningProviderOptionsFor(
          args.modelData,
          buildCallProviderOptions(args.modelData),
          { kind: 'utility' },
        )
      : undefined;
    const userId = `improve-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const result = await agent.generateText(
      ctx,
      { userId },
      {
        prompt: args.originalMessage,
        ...(callProviderOptions
          ? { providerOptions: callProviderOptions }
          : {}),
      },
      { storageOptions: { saveMessages: 'none' } },
    );

    return { improvedMessage: result.text || args.originalMessage };
  } catch (error) {
    console.error('[improveMessage] Error:', error);
    return {
      improvedMessage: args.originalMessage,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
