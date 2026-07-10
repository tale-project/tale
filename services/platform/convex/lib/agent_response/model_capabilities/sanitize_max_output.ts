/**
 * Drop an output-token cap that leaves no room for the prompt.
 *
 * OpenRouter (and some other catalogs) occasionally report
 * `top_provider.max_completion_tokens` equal to the model's full
 * `context_length`. Sending that as `max_tokens` makes every request fail:
 * input + output > context. Treat that as "unknown cap" so callers fall back
 * to a safe default (e.g. createAgentConfig's 32768).
 */
export function usableMaxOutputTokens(
  maxOutputTokens: number | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (maxOutputTokens == null || !(maxOutputTokens > 0)) return undefined;
  if (
    contextWindow != null &&
    contextWindow > 0 &&
    maxOutputTokens >= contextWindow
  ) {
    return undefined;
  }
  return maxOutputTokens;
}
