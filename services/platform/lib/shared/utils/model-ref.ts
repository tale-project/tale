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
