/**
 * The classifier contract: the shared types every line-classifier returns, plus
 * the `noise` constructor. A classifier is a PURE `(line) -> ClassifiedLine` that
 * decides whether a raw subprocess line is `noise` (collapse to one live phase
 * line), `progress` (advance a single live line), `info` (a clean status), or
 * `warn`/`error` (surface verbatim). EVERY line keeps its `raw` so the process
 * supervisor can retain it in a ring buffer for `--verbose` and failure dumps.
 *
 * node-free: pure types, no `node:*`.
 */

export type LineKind = 'noise' | 'progress' | 'info' | 'warn' | 'error';

export type LineSource =
  | 'docker-compose'
  | 'buildkit'
  | 'convex'
  | 'vite'
  | 'platform-container'
  | 'generic';

export interface ProgressStatus {
  phase?: string;
  current?: number;
  total?: number;
}

export interface ClassifiedLine {
  kind: LineKind;
  /** Cleaned display text; omit to hide the line entirely. */
  text?: string;
  status?: ProgressStatus;
  /** The original line, always retained for the ring buffer / `--verbose`. */
  raw: string;
  source?: LineSource;
  /** Monotonic receipt time; stamped by the supervisor, 0 from pure classifiers. */
  receivedAt?: number;
}

export type Classifier = (line: string) => ClassifiedLine;

/** A `noise` verdict carrying the raw line and its source (the common fallthrough). */
export function noise(raw: string, source: LineSource): ClassifiedLine {
  return { kind: 'noise', raw, source };
}
