import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(
  new URL('../../../packages/ui/bin/build-client.ts', import.meta.url),
);
const marker = '[build-client] build resolved, exiting 0';

describe('client build process completion', () => {
  test.each(['success', 'build failure', 'close failure'])(
    '%s preserves Vite completion and exit status',
    (outcome) => {
      const cwd = mkdtempSync(join(tmpdir(), 'tale-client-build-'));
      try {
        writeFileSync(
          join(cwd, 'index.html'),
          '<div id="fixture">selected service cwd</div><script type="module" src="/main.js"></script>',
        );
        writeFileSync(
          join(cwd, 'main.js'),
          'document.getElementById("fixture").dataset.loaded = "true";',
        );
        writeFileSync(
          join(cwd, 'vite.config.mjs'),
          `
        import { writeFile } from 'node:fs/promises';
        export default {
          build: { outDir: 'service-output' },
          plugins: [{
            name: 'completion-fixture',
            buildStart() { ${outcome === 'build failure' ? 'throw new Error("fixture build failure");' : ''} },
            async closeBundle() {
              await new Promise(resolve => setTimeout(resolve, 100));
              ${outcome === 'close failure' ? 'throw new Error("fixture close failure");' : ''}
              await writeFile('plugin-finished', 'all asynchronous output written');
              // The maintained helper must exit even when a plugin retains a handle.
              setInterval(() => {}, 1000);
            }
          }]
        };
      `,
        );
        const result = spawnSync(process.execPath, ['--bun', helper], {
          cwd,
          encoding: 'utf8',
          timeout: 15_000,
          killSignal: 'SIGKILL',
          maxBuffer: 1024 * 1024,
        });
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        if (outcome === 'success') {
          expect(result.status).toBe(0);
          expect(result.stdout).toContain(marker);
          expect(readFileSync(join(cwd, 'plugin-finished'), 'utf8')).toBe(
            'all asynchronous output written',
          );
          expect(
            readFileSync(join(cwd, 'service-output/index.html'), 'utf8'),
          ).toContain('selected service cwd');
        } else {
          expect(result.status).toBe(1);
          expect(result.stdout).not.toContain(marker);
          expect(result.stderr).toContain(
            outcome === 'build failure'
              ? 'fixture build failure'
              : 'fixture close failure',
          );
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
