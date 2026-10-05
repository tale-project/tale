import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Native CI runs source commands before building, then selects only its
 * compiled artifact. Resolve paths before command fixtures change cwd; an
 * explicitly selected binary must never fall back to the source entry point. */
export function commandTargets(
  binary: string | undefined,
): [mode: 'source' | 'compiled', executable: string[]][] {
  return binary
    ? [['compiled', [resolve(binary)]]]
    : [
        [
          'source',
          [
            process.execPath,
            fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
          ],
        ],
      ];
}
