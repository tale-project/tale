import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { renderBootShell } from '../app/components/layout/boot-shell-render';

/**
 * Build step (after `vite build`): renders the dashboard boot shell —
 * `DashboardShellFrame`, the same component React shows while access
 * resolves — to `dist/boot-shell.html`. The HTML server (`server.ts` in
 * production, the inject-boot-shell Vite middleware in dev/preview) injects
 * it into `#root` for dashboard navigations, so the first paint already
 * shows the sidebar rail. Prerendering from the real component keeps the
 * served shell and the React placeholder one artifact — there is no
 * hand-written copy to drift.
 */

const distDir = join(import.meta.dirname, '..', 'dist');

if (!existsSync(join(distDir, 'index.html'))) {
  console.error(
    'prerender-boot-shell: dist/index.html not found — run `vite build` first.',
  );
  process.exit(1);
}

const html = renderBootShell();
const outFile = join(distDir, 'boot-shell.html');
await Bun.write(outFile, html);
console.log(`prerender-boot-shell: wrote ${outFile} (${html.length} bytes)`);
