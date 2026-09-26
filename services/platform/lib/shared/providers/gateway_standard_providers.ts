/**
 * Provider names the sandbox LLM gateway serves with a BUILT-IN implementation
 * (its own base URL + request shaping). Mirrors the gateway's
 * `StandardProviders` (maximhq/bifrost core/schemas/bifrost.go @ core/v1.5.13).
 * This is NOT an allowlist of permitted providers — any connector can be
 * provisioned; it is the set the gateway RESERVES: it rejects
 * `custom_provider_config` on these names (400) and overriding their
 * `network_config.base_url` breaks the built-in URL construction. A standard
 * provider keeps native dispatch (its built-in implementation owns the wire
 * format, including the Responses API); every other connector is provisioned
 * as a custom OpenAI-compatible (chat-only) or Anthropic-format upstream.
 * Shared by the provisioner/mint (record names) and the serving resolver
 * (which door a harness rides) so the two can never disagree.
 */
const LLM_GATEWAY_STANDARD_PROVIDERS = new Set([
  'openai',
  'azure',
  'anthropic',
  'bedrock',
  'cohere',
  'vertex',
  'mistral',
  'ollama',
  'groq',
  'sgl',
  'parasail',
  'perplexity',
  'cerebras',
  'gemini',
  'openrouter',
  'elevenlabs',
  'huggingface',
  'nebius',
  'xai',
  'replicate',
  'vllm',
  'runway',
  'fireworks',
]);

/** Whether the gateway has a built-in implementation for this provider name
 * (and so owns its wire format + rejects custom_provider_config). */
export function isStandardGatewayProvider(name: string): boolean {
  return LLM_GATEWAY_STANDARD_PROVIDERS.has(name);
}
