/**
 * Read a stack trace of the built backend back in terms of its sources.
 *
 * The production backend is minified JavaScript (`scripts/build-backend.ts`),
 * so a frame it logs reads `at Tb (file:///app/backend-dist/main.js:1:8812345)`.
 * Its source maps are written beside it and never loaded by the running
 * process — holding them in memory is what the build exists to avoid. This
 * maps a logged trace afterwards, offline, one position at a time.
 *
 * Only positions are mapped. A frame keeps the minified name it was logged
 * with: a source map names the token at a position, not the function around
 * it, so the source line is what says where the frame is.
 */

import { SourceMap } from 'node:module';

/** One built file's source map as parsed JSON, or null when it has none. */
export type LoadSourceMap = (builtFile: string) => unknown;

/** A position in a built file, as a stack frame prints it:
 * `file:///app/backend-dist/main.js:1:8812345`. */
const BUILT_POSITION =
  /(?:file:\/\/)?(?:\/[^\s():]*\/)?([\w.-]+\.js):(\d+):(\d+)/g;

type SourceMapPayload = ConstructorParameters<typeof SourceMap>[0];

function isSourceMapPayload(value: unknown): value is SourceMapPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'mappings' in value &&
    typeof value.mappings === 'string' &&
    'sources' in value &&
    Array.isArray(value.sources)
  );
}

/**
 * The trace with every position in a built file rewritten to its source
 * file, line and column. A position in a file without a map, and any other
 * text, passes through unchanged.
 */
export function symbolicate(trace: string, loadMap: LoadSourceMap): string {
  const maps = new Map<string, SourceMap | null>();
  const mapOf = (file: string): SourceMap | null => {
    let map = maps.get(file);
    if (map === undefined) {
      const payload = loadMap(file);
      map = isSourceMapPayload(payload) ? new SourceMap(payload) : null;
      maps.set(file, map);
    }
    return map;
  };

  return trace.replace(
    BUILT_POSITION,
    (position, file: string, line: string, column: string) => {
      const entry = mapOf(file)?.findEntry(
        Number(line) - 1,
        Number(column) - 1,
      );
      if (
        entry === undefined ||
        !('originalSource' in entry) ||
        typeof entry.originalSource !== 'string'
      )
        return position;
      return `${sourcePath(entry.originalSource)}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
    },
  );
}

/** The directories a source of the backend lives under, from the platform's
 * root (`backend/`, `lib/`) or the repository's (`packages/`). */
const SOURCE_ROOTS = new Set(['backend', 'lib', 'packages']);

/**
 * A map's source reference as a path a reader can open: from the platform's
 * root for the platform's own code, from `node_modules` for a dependency. A
 * map writes it relative to the built file, `../backend/main.ts`.
 */
export function sourcePath(source: string): string {
  const segments: string[] = [];
  for (const segment of source.replace(/^file:\/\//, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const dependency = segments.lastIndexOf('node_modules');
  if (dependency !== -1) return segments.slice(dependency).join('/');
  const start = segments.findIndex((segment) => SOURCE_ROOTS.has(segment));
  return segments.slice(Math.max(start, 0)).join('/');
}
