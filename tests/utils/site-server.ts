// Boots `startReactServer` in a real Bun child process, so an integration test
// proves the server the sites run — `Bun.serve` and `Bun.file` themselves —
// and not a stand-in for them.

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** Absolute path of `@tale/ui/server`, for a script to import. */
export const serverModule = path.join(PKG_DIR, 'src/server/index.ts');

/** Absolute path of `@tale/ui/monitoring/server`, for a script to import. */
export const monitoringModule = path.join(PKG_DIR, 'src/monitoring/server.ts');

/**
 * Spawns Bun scripts and kills them together. Call `stop` from `afterAll`.
 */
export function bunServers() {
  const children: ChildProcess[] = [];
  return {
    /**
     * Runs `script` under `bun --eval` and resolves once it prints
     * `READY <port> [<port> …]`, with one `http://127.0.0.1:<port>` origin
     * per port in the order printed. Rejects if the process exits first or
     * prints nothing within 20 s; the error carries its output.
     */
    start(script: string): Promise<[string, ...string[]]> {
      const child = spawn('bun', ['--eval', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      return new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(
          () => reject(new Error(`Bun server did not start: ${output}`)),
          20_000,
        );
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = /READY (\d+(?: \d+)*)\r?\n/.exec(output);
          if (match?.[1]) {
            clearTimeout(timeout);
            resolve(
              match[1].split(' ').map((port) => `http://127.0.0.1:${port}`) as [
                string,
                ...string[],
              ],
            );
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Bun exited ${code}: ${output}`));
        });
      });
    },
    stop() {
      for (const child of children) child.kill();
    },
  };
}
