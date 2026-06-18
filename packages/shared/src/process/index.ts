/**
 * `@tale/shared/process` — the CLI/script-only process supervisor.
 *
 * Captured spawn (never inherit), line piping with a per-line byte cap, and a
 * bounded ring buffer. Value-imports `node:child_process` and uses `Bun`, so
 * this subpath must never be reachable from `@tale/shared/logging/logger` (the
 * Convex V8 boundary); a boundary test enforces that.
 */

export { pipeLines, pipeNodeStream } from './pipe-lines';
export { RingBuffer } from './ring-buffer';
export {
  type CapturedProcess,
  type SpawnBackend,
  type SpawnCapturedOptions,
  spawnCaptured,
} from './spawn-captured';
