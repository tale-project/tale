/**
 * Classifier combinators: `chain` (run several, last non-noise wins) and
 * `createStreamClassifier` (a per-stream state machine that keeps multi-line
 * errors surfaced). A pure `(line) -> ClassifiedLine` cannot represent a stack
 * trace, so without the stream wrapper a Vite transform error or a Convex push
 * error would be LESS visible than today's raw inherit — the opposite of the
 * goal.
 *
 * node-free.
 */

import type { ClassifiedLine, Classifier } from './kinds';

/**
 * Combine classifiers; a later one's non-`noise` verdict wins (so a BuildKit
 * `ERROR` beats a compose lifecycle line on the same docker stream — callers
 * order the chain accordingly). All-noise returns noise carrying the raw line.
 */
export function chain(...classifiers: Classifier[]): Classifier {
  return (line) => {
    let result: ClassifiedLine = { kind: 'noise', raw: line };
    for (const classify of classifiers) {
      const r = classify(line);
      if (r.kind !== 'noise') result = r;
    }
    return result;
  };
}

/** Looks like the continuation of a previous error (blank, indent, stack frame, caret, ellipsis, code frame). */
function looksLikeContinuation(raw: string): boolean {
  if (raw.trim() === '') return true;
  return (
    /^\s+/.test(raw) ||
    /^\s*(at\s|Caused by|\.\.\.|[\^~]+\s*$|\d+\s*[|│])/.test(raw)
  );
}

/**
 * Wrap a classifier so multi-line errors stay surfaced: once a line classifies
 * as `error`, subsequent continuation lines inherit `error` until a clearly new
 * (non-continuation) line resets the state. The returned function is stateful —
 * create one per stream, never share across sources.
 */
export function createStreamClassifier(base: Classifier): Classifier {
  let inError = false;
  // A "block" error (e.g. a Convex push failure) whose body is left-aligned
  // prose, not an indented stack: stay surfaced through ANY line until a real
  // milestone, since the body won't satisfy `looksLikeContinuation`.
  let inBlock = false;
  return (line) => {
    const result = base(line);
    if (result.kind === 'error') {
      inError = true;
      if (result.errorBlock) inBlock = true;
      return result;
    }
    if (inBlock) {
      // A genuine new milestone (a push retry's progress, "N functions
      // ready", a schema/index line) or an explicit block-breaker (a runtime
      // function log with its own severity tag) ends the block; everything
      // else is the error body and must stay visible.
      if (
        result.kind === 'info' ||
        result.kind === 'progress' ||
        result.blockEnd
      ) {
        inError = false;
        inBlock = false;
        return result;
      }
      return { ...result, kind: 'error', text: result.text ?? result.raw };
    }
    if (inError) {
      if (looksLikeContinuation(result.raw)) {
        return { ...result, kind: 'error', text: result.text ?? result.raw };
      }
      inError = false;
    }
    return result;
  };
}
