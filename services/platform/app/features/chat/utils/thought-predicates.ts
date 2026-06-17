/**
 * Cheap, allocation-free predicates over a UIMessage's `parts`, used on the
 * per-token streaming render hot path (message-list visibility + bubble gate)
 * where building the full segment list every render would be wasteful.
 *
 * Defensive by design: `parts` is typed loosely and the SDK's union is wide, so
 * each entry is narrowed via property checks rather than trusting the
 * discriminant — same style as {@link ./build-message-segments}.
 */

import { isRecord } from '@/lib/utils/type-utils';

/**
 * Does this message have ANY reasoning or concrete tool step? Equivalent to
 * `buildMessageSegments(parts).segments.some(s => s.kind !== 'text')` but
 * early-exits on the first qualifying part and allocates nothing.
 */
export function hasThoughtSteps(
  parts: readonly unknown[] | undefined,
): boolean {
  if (!Array.isArray(parts)) return false;
  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    if (raw.type === 'reasoning') return true;
    if (raw.type.startsWith('tool-')) {
      const name = raw.type.slice('tool-'.length);
      if (name && name !== 'invocation') return true;
    }
  }
  return false;
}

/**
 * Does this message have a tool part still mid-flight (input-streaming /
 * input-available)? Used to treat a pending tool-only turn (observed before any
 * reasoning/text streams) as active. Skips the generic `tool-invocation`
 * placeholder, matching {@link hasThoughtSteps} and the builder.
 */
export function hasInFlightTool(
  parts: readonly unknown[] | undefined,
): boolean {
  if (!Array.isArray(parts)) return false;
  for (const raw of parts) {
    if (!isRecord(raw) || typeof raw.type !== 'string') continue;
    if (!raw.type.startsWith('tool-')) continue;
    const name = raw.type.slice('tool-'.length);
    if (!name || name === 'invocation') continue;
    if (raw.state === 'input-streaming' || raw.state === 'input-available') {
      return true;
    }
  }
  return false;
}
