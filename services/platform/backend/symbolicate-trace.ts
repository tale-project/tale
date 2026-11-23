/**
 * Map a stack trace of the built backend to its sources, with the source maps
 * the build wrote beside it:
 *
 *   docker logs <container> 2>&1 | docker exec -i <container> \
 *     node /app/backend-dist/symbolicate-trace.js
 *   node backend-dist/symbolicate-trace.js trace.txt
 *
 * It reads the trace from the file it is given, or from standard input, and
 * writes it back with each built position rewritten (`lib/symbolicate.ts`).
 * Built by `scripts/build-backend.ts` as an entry of its own, so it runs from
 * the image with plain `node` and loads none of the backend.
 */

import { readFileSync } from 'node:fs';

import { symbolicate } from './lib/symbolicate.ts';

const BUILD_DIRECTORY = new URL('.', import.meta.url);

/** A built file's map from beside this program, or null when none is there. */
function loadMap(builtFile: string): unknown {
  let text: string;
  try {
    text = readFileSync(new URL(`${builtFile}.map`, BUILD_DIRECTORY), 'utf8');
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return null;
    throw error;
  }
  return JSON.parse(text);
}

const file = process.argv[2];
const trace = readFileSync(file === undefined ? 0 : file, 'utf8');
process.stdout.write(symbolicate(trace, loadMap));
