import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vm from 'node:vm';

import { createServer, preview } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { injectAcceptLanguage } from './inject-accept-language';
import { injectEnv } from './inject-env';

/** The `index.html` script both placeholders live in, as the real page has it. */
const INDEX_HTML = `<!doctype html>
<html>
  <head></head>
  <body>
    <div id="root"></div>
    <script id="__ENV__">
      window.__ENV__ = '__ENV_PLACEHOLDER__';
      window.__ACCEPT_LANGUAGE__ = '__ACCEPT_LANGUAGE_PLACEHOLDER__';
    </script>
  </body>
</html>
`;

const SUPPORT_URL = "https://help.example.com/a$'b?x=$`&y=$$";
const ACCEPT_LANGUAGE = "de-CH$'</script><script>window.injected = true";

/** Run the page's `__ENV__` script the way a browser reads it. */
function runEnvScript(html: string): Record<string, unknown> {
  const script = /<script id="__ENV__">([\s\S]*?)<\/script/i.exec(html);
  if (!script) throw new Error('the __ENV__ script is missing');
  const window: Record<string, unknown> = {};
  vm.runInNewContext(script[1], { window });
  return window;
}

describe('the dev and preview pages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['dev', 'preview'] as const)(
    'carry the runtime values verbatim in %s',
    async (mode) => {
      vi.stubEnv('SITE_URL', 'https://tale.example.com');
      vi.stubEnv('TALE_CONTACT_SUPPORT_URL', SUPPORT_URL);
      const root = await mkdtemp(join(tmpdir(), 'tale-inject-env-'));
      let closeVite: (() => Promise<void>) | undefined;
      try {
        await writeFile(join(root, 'index.html'), INDEX_HTML);
        await mkdir(join(root, 'dist'));
        await writeFile(join(root, 'dist/index.html'), INDEX_HTML);
        const listen = { host: '127.0.0.1', port: 0 };
        const config = {
          configFile: false as const,
          root,
          logLevel: 'silent' as const,
          // The order `vite.config.ts` registers them in.
          plugins: [injectAcceptLanguage(), injectEnv()],
          server: listen,
          preview: listen,
          // Absolute: the preview middleware reads `build.outDir` as given,
          // and this root is not the working directory.
          build: { outDir: join(root, 'dist') },
          optimizeDeps: { noDiscovery: true },
        };
        let address;
        if (mode === 'dev') {
          const vite = await createServer(config);
          closeVite = () => vite.close();
          await vite.listen();
          address = vite.httpServer?.address();
        } else {
          const vite = await preview(config);
          closeVite = () =>
            new Promise<void>((resolve, reject) =>
              vite.httpServer.close((error) =>
                error ? reject(error) : resolve(),
              ),
            );
          address = vite.httpServer.address();
        }
        if (
          address === null ||
          address === undefined ||
          typeof address === 'string'
        )
          throw new Error('Expected TCP Vite server');

        const response = await fetch(`http://127.0.0.1:${address.port}/`, {
          headers: { accept: 'text/html', 'accept-language': ACCEPT_LANGUAGE },
        });
        expect(response.status).toBe(200);
        const window = runEnvScript(await response.text());
        expect(window.__ENV__).toMatchObject({
          SITE_URL: 'https://tale.example.com',
          TALE_CONTACT_SUPPORT_URL: SUPPORT_URL,
        });
        expect(window.__ACCEPT_LANGUAGE__).toBe(ACCEPT_LANGUAGE);
        expect(window).not.toHaveProperty('injected');
      } finally {
        await closeVite?.();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
