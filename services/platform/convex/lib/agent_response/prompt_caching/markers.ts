/**
 * The stable/volatile boundary marker for prompt caching (pure, no IO).
 *
 * `buildSystemPrompt` assembles the system prompt as a stable prefix (agent
 * identity, untrusted-content rules, project instructions, user
 * personalization — identical across a thread's turns and across threads on the
 * same agent/project/user) followed by a volatile tail (per-turn thread
 * context, then the response-language directive). Prompt caching is only
 * worthwhile on the STABLE prefix, but the prompt reaches the model as one
 * `system` string, so we embed an invisible marker at the boundary.
 *
 * The cache-control middleware (`./middleware`) is the single consumer:
 *   - explicit-breakpoints models -> split the system string at the marker into
 *     a cacheable stable system message + a volatile one;
 *   - everything else -> strip the marker (rejoining to the exact original
 *     string, so non-caching providers see no change).
 *
 * The marker is built from NUL chars so it can never collide with real prompt
 * text and is JSON-safe. It replaces exactly one `'\n\n'` separator, so
 * stripping it reproduces the original `'\n\n'`-joined prompt byte-for-byte.
 */
const NUL = String.fromCharCode(0);
export const CACHE_BREAKPOINT_MARKER = `${NUL}${NUL}TALE_CACHE_BREAKPOINT${NUL}${NUL}`;

interface SplitSystemPrompt {
  /** The cacheable prefix (empty when there was no marker). */
  stable: string;
  /** The per-turn tail (the whole prompt when there was no marker). */
  volatile: string;
  /** Whether a boundary marker was present. */
  hadMarker: boolean;
}

/**
 * Split a system prompt at the cache boundary. When no marker is present
 * (e.g. a system prompt not produced by `buildSystemPrompt`), the whole string
 * is treated as volatile so nothing is cached.
 */
export function splitSystemPromptAtBreakpoint(
  system: string,
): SplitSystemPrompt {
  const idx = system.indexOf(CACHE_BREAKPOINT_MARKER);
  if (idx === -1) return { stable: '', volatile: system, hadMarker: false };
  return {
    stable: system.slice(0, idx),
    volatile: system.slice(idx + CACHE_BREAKPOINT_MARKER.length),
    hadMarker: true,
  };
}

/**
 * Remove the boundary marker, rejoining to the exact original `'\n\n'`-joined
 * string. Used for non-caching providers and defensive log sanitization.
 */
export function stripCacheBreakpoint(system: string): string {
  return system.split(CACHE_BREAKPOINT_MARKER).join('\n\n');
}
