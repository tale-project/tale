import { openai } from './openai_provider';
import { Agent } from '@convex-dev/agent';
import { loadConvexToolsAsObject } from '../agent_tools/load_convex_tools_as_object';
import type { ToolName } from '../agent_tools/tool_registry';

/**
 * Create a general Agent configuration object compatible with @convex-dev/agent.
 *
 * - Supports merging Convex tools (by name) with extra tools (object)
 * - Supports extra tools (e.g., dynamic json_output tool) via extraTools option
 * - Appends instruction suffixes to ensure a final assistant message after tool use
 *   and stricter formatting when outputFormat === 'json'
 * - Optionally enables vector search for retrieving semantically relevant older messages
 */
export function createAgentConfig(opts: {
  name: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  instructions: string;
  outputFormat?: 'text' | 'json';
  convexToolNames?: ToolName[];
  /** Additional tools to merge (e.g., dynamic json_output tool) */
  extraTools?: Record<string, unknown>;
  maxSteps?: number;
  /** Enable vector search for finding semantically relevant older messages (defaults to false) */
  enableVectorSearch?: boolean;
}): ConstructorParameters<typeof Agent>[1] {
  // Build Convex tools as an object when names are provided
  const convexToolsObject = opts.convexToolNames?.length
    ? loadConvexToolsAsObject(opts.convexToolNames)
    : {};

  // Merge Convex tools + extra tools into a single tools object
  const mergedTools: Record<string, unknown> = {
    ...(convexToolsObject || {}),
    ...(opts.extraTools || {}),
  };

  const hasAnyTools = Object.keys(mergedTools).length > 0;

  // Augment instructions to ensure a final assistant message after any tool use
  const suffixParts: string[] = [
    'If you use any tools, you must always conclude by producing a final assistant message with the answer.',
  ];
  if (opts.outputFormat === 'json') {
    suffixParts.push(
      'Return only a single JSON object and no extra commentary. If you used tools, still end with that JSON object.',
    );
  }
  const finalInstructions = [opts.instructions, suffixParts.join(' ')]
    .filter(Boolean)
    .join('\n\n');

  const envModel = (process.env.OPENAI_MODEL || '').trim();
  const model = opts.model ?? envModel;

  if (!model) {
    throw new Error(
      'OPENAI_MODEL environment variable is required for Agent configuration but is not set',
    );
  }

  const callSettings =
    typeof opts.temperature === 'number'
      ? { temperature: opts.temperature }
      : undefined;

  // Build text embedding model for vector search if enabled
  // Requires OPENAI_EMBEDDING_MODEL env var to be set
  let embeddingModel: string | undefined;
  const enableVectorSearch = opts.enableVectorSearch ?? false;
  if (enableVectorSearch) {
    embeddingModel = (process.env.OPENAI_EMBEDDING_MODEL || '').trim();
    if (!embeddingModel) {
      throw new Error(
        'OPENAI_EMBEDDING_MODEL environment variable is required when enableVectorSearch is true',
      );
    }
  }

  const hasMaxTokens = typeof opts.maxTokens === 'number';

  return {
    name: opts.name,
    instructions: finalInstructions,
    languageModel: openai.chat(model),
    ...(callSettings ? { callSettings } : {}),
    ...(hasMaxTokens
      ? { providerOptions: { openai: { maxOutputTokens: opts.maxTokens } } }
      : {}),
    ...(hasAnyTools ? { tools: mergedTools } : {}),
    ...(typeof opts.maxSteps === 'number' ? { maxSteps: opts.maxSteps } : {}),
    // Add text embedding model for vector search
    ...(embeddingModel
      ? { textEmbeddingModel: openai.embedding(embeddingModel) }
      : {}),
  } as ConstructorParameters<typeof Agent>[1];
}
