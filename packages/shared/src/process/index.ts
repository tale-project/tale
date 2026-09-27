/**
 * `@tale/shared/process` — CLI/script-only helpers for a subprocess's output.
 *
 * Line piping for both stream shapes, a web `ReadableStream` (`Bun.spawn`) and
 * a Node `Readable` (`node:child_process`), with a per-line cap; a bounded
 * `RingBuffer` that keeps a stream's most recent lines for a failure dump; and
 * `openUrl`, which opens the user's browser. `openUrl` uses `Bun.spawn`, so
 * this subpath must never be reachable from `@tale/shared/logging/logger` (the
 * Convex V8 boundary); a boundary test enforces that.
 */

export { openUrl, type OpenUrlOptions } from './open-url';
export { pipeLines, pipeNodeStream } from './pipe-lines';
export { RingBuffer } from './ring-buffer';
