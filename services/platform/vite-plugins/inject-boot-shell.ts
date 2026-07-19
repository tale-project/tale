import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import {
  injectBootShell,
  shouldServeBootShell,
} from '../lib/shared/boot-shell';

/**
 * Dev/preview parity for the production boot shell (`server.ts` owns prod):
 * when a dashboard navigation is served, inject the prerendered sidebar-rail
 * skeleton into `#root`, so the first paint shows the dashboard chrome
 * before any JS runs.
 *
 * Dev renders the shell live through the module graph (edits to the
 * placeholder show up on reload); preview — the prod-build E2E serving
 * path — reads the `dist/boot-shell.html` artifact the build's prerender
 * step wrote, exactly like `server.ts` does.
 *
 * Registers pre-middleware that patches `res.end` before the HTML response
 * is sent (same interception pattern as `inject-accept-language`); in
 * preview it must register before `inject-env`'s SPA-fallback middleware so
 * the patch wraps the response that middleware writes.
 */
export function injectBootShellPlugin(): Plugin {
  const basePath = () => (process.env.BASE_PATH ?? '').replace(/\/$/, '');

  const patchResEnd = (
    res: import('node:http').ServerResponse,
    shellHtml: string,
  ) => {
    const originalEnd = res.end.bind(res);
    res.end = (chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string' && chunk.includes('<div id="root">')) {
        // @ts-expect-error — forwarding rest args to overloaded res.end signature
        return originalEnd(injectBootShell(chunk, shellHtml), ...rest);
      }
      // @ts-expect-error — forwarding rest args to overloaded res.end signature
      return originalEnd(chunk, ...rest);
    };
  };

  const wantsShell = (req: import('node:http').IncomingMessage): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (!req.url) return false;
    const accept = req.headers['accept'] ?? '';
    if (typeof accept !== 'string' || !accept.includes('text/html')) {
      return false;
    }
    return shouldServeBootShell(req.url.split('?')[0], basePath());
  };

  return {
    name: 'inject-boot-shell',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!wantsShell(req)) return next();
        // Render through the dev module graph, then install the sync
        // res.end patch — the patch itself can't await.
        void server
          .ssrLoadModule('/app/components/layout/boot-shell-render.tsx')
          .then((mod) => {
            // ssrLoadModule returns an untyped record; the module's real
            // shape is its own typed exports.
            type RenderModule =
              typeof import('../app/components/layout/boot-shell-render');
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
            const render = (mod as RenderModule).renderBootShell;
            patchResEnd(res, render());
          })
          .catch((error: unknown) => {
            console.warn('[inject-boot-shell] dev render failed', error);
          })
          .finally(next);
      });
    },
    configurePreviewServer(server) {
      let template: string | null | undefined;
      const readTemplate = (): string | null => {
        if (template === undefined) {
          const file = join(server.config.build.outDir, 'boot-shell.html');
          try {
            template = readFileSync(file, 'utf8');
          } catch (error) {
            console.warn(
              `[inject-boot-shell] preview: missing ${file} — did the build run prerender-boot-shell?`,
              error,
            );
            template = null;
          }
        }
        return template;
      };

      server.middlewares.use((req, res, next) => {
        if (wantsShell(req)) {
          const shell = readTemplate();
          if (shell) patchResEnd(res, shell);
        }
        next();
      });
    },
  };
}
