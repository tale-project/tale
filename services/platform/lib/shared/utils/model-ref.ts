/**
 * Model refs are strings of the form `[<provider>:]<model-id>[@<quantization>]`:
 *
 * - `provider` (optional): the provider config slug, e.g. `openrouter`. Tight
 *   regex (`[a-z0-9_-]{1,64}`) keeps bedrock-style ids that contain colons
 *   (`bedrock:anthropic.claude-...:0`) parseable as unqualified.
 * - `model-id`: the bare id from the provider JSON, e.g. `z-ai/glm-5.1`.
 * - `quantization` (optional): a quantization variant pin, e.g. `fp8`/`fp4`/
 *   `bf16`. Used by providers (e.g. OpenRouter) that surface multiple weight
 *   formats for the same base model. The token regex is `^[a-z0-9]{1,16}$`
 *   so an `@` followed by anything else (uppercase, punctuation, empty) is
 *   treated as part of the modelId rather than a half-parsed variant — the
 *   author gets a predictable failure at lookup time, not silent misroute.
 *
 * Variants are a UI-driven concept: the chat picker expands a model with a
 * `quantizations` array into one entry per quantization, the user's pick is
 * encoded as `@<quant>`, and the resolver pins
 * `providerOptions.provider.quantizations` to a single-element array at call
 * time.
 */
interface ParsedModelRef {
  providerName?: string;
  modelId: string;
  quantization?: string;
}

const PROVIDER_PREFIX_RE = /^[a-z0-9_-]{1,64}$/;
const QUANTIZATION_TOKEN_RE = /^[a-z0-9]{1,16}$/;

function splitQuantization(modelId: string): {
  modelId: string;
  quantization?: string;
} {
  const at = modelId.lastIndexOf('@');
  if (at <= 0 || at === modelId.length - 1) return { modelId };
  const candidate = modelId.slice(at + 1);
  if (!QUANTIZATION_TOKEN_RE.test(candidate)) return { modelId };
  return { modelId: modelId.slice(0, at), quantization: candidate };
}

export function parseModelRef(ref: string): ParsedModelRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new Error('Model ref must be non-empty');
  }
  if (trimmed.startsWith(':') || trimmed.endsWith(':')) {
    throw new Error(`Invalid model ref "${ref}": cannot start or end with ":"`);
  }
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const rest = trimmed.slice(colon + 1);
    if (PROVIDER_PREFIX_RE.test(prefix) && rest) {
      const { modelId, quantization } = splitQuantization(rest);
      return quantization
        ? { providerName: prefix, modelId, quantization }
        : { providerName: prefix, modelId };
    }
  }
  const { modelId, quantization } = splitQuantization(trimmed);
  return quantization ? { modelId, quantization } : { modelId };
}

export function formatModelRef({
  providerName,
  modelId,
  quantization,
}: ParsedModelRef): string {
  const head = providerName ? `${providerName}:${modelId}` : modelId;
  return quantization ? `${head}@${quantization}` : head;
}

/**
 * Returns the bare model id, stripping both the provider prefix and the
 * quantization variant. This is the canonical key for governance policies,
 * the modelInfoMap (keyed by JSON model id), and any place that needs the
 * id "as it appears in the provider config".
 */
export function stripModelRefQualifier(ref: string): string {
  return parseModelRef(ref).modelId;
}

export function isValidModelRef(ref: string): boolean {
  try {
    parseModelRef(ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a bare model id to its lowercased *family* segment for capability
 * matching. OpenRouter-style ids look like `anthropic/claude-sonnet-4`; the
 * family signal is the segment after the last slash. This strips the vendor
 * slash-prefix (NOT the `provider:` colon prefix — use `parseModelRef` first
 * for that) and lowercases, so `Anthropic/Claude-Sonnet-4` → `claude-sonnet-4`.
 *
 * Shared by the reasoning-capability resolver, the prompt-caching strategy, and
 * the built-in model registry so they all key off the same normalized family.
 */
export function stripProviderPrefix(modelId: string): string {
  let id = modelId;
  // Defensively strip a clean single `provider:` qualifier (e.g. `openai:gpt-5`)
  // so this family key is correct even if a caller skipped `parseModelRef`.
  // Bedrock-style ids carry internal colons (`bedrock:anthropic.claude-...:0`);
  // a remaining colon in the tail signals that this is NOT a clean single
  // qualifier, so leave such ids untouched.
  const colon = id.indexOf(':');
  if (
    colon > 0 &&
    PROVIDER_PREFIX_RE.test(id.slice(0, colon).toLowerCase()) &&
    !id.slice(colon + 1).includes(':')
  ) {
    id = id.slice(colon + 1);
  }
  const slash = id.lastIndexOf('/');
  const bare = slash >= 0 ? id.slice(slash + 1) : id;
  return bare.toLowerCase();
}
