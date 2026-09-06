import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Plugin } from 'vite';

import { parseSessionIdleTimeoutMinutes } from '../lib/shared/session-idle';

interface EnvConfig {
  SITE_URL: string;
  BASE_PATH: string;
  FILE_EVENTS_ENABLED: boolean;
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION?: string;
  SESSION_IDLE_TIMEOUT_MINUTES?: number;
}

function getEnvConfig(): EnvConfig {
  if (!process.env.SITE_URL) {
    throw new Error('Missing required environment variable: SITE_URL');
  }
  return {
    SITE_URL: process.env.SITE_URL,
    BASE_PATH: (process.env.BASE_PATH ?? '').replace(/\/$/, ''),
    FILE_EVENTS_ENABLED: process.env.TALE_FILE_EVENTS === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
    SESSION_IDLE_TIMEOUT_MINUTES: parseSessionIdleTimeoutMinutes() ?? undefined,
  };
}

export function injectEnv(): Plugin {
  let envConfig: EnvConfig;
  let isProduction = false;

  return {
    name: 'inject-env',
    configResolved(config) {
      isProduction = config.command === 'build';
      if (!isProduction) {
        envConfig = getEnvConfig();
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (isProduction) {
          return html;
        }
        const envScript = `window.__ENV__ = ${JSON.stringify(envConfig)};`;
        return html.replace(
          /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
          envScript,
        );
      },
    },
    // `vite preview` (the prod-build E2E serving path) serves the static built
    // `index.html` verbatim — `transformIndexHtml` only runs at build/dev time,
    // so the `__ENV__` / `__ACCEPT_LANGUAGE__` placeholders would reach the
    // browser un-replaced and the SPA couldn't read SITE_URL. This middleware
    // mirrors what `server.ts` does in production: intercept SPA navigations,
    // read the built `index.html`, and inject the runtime env + Accept-Language
    // before responding. Static assets (paths with a file extension) fall
    // through to Vite's own static handler.
    configurePreviewServer(server) {
      const env = getEnvConfig();
      const envScript = `window.__ENV__ = ${JSON.stringify(env)};`;
      const indexPath = join(server.config.build.outDir, 'index.html');
      // The build uses a relative `base` ('./'), so lazy-loaded route chunks
      // resolve their `./assets/…` URLs against the current path — on a deep
      // route like `/dashboard/create-organization` they'd 404. Production
      // `server.ts` fixes this by injecting `<base href="…/">`; mirror it.
      const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
      let template: string | null = null;

      // Convex proxy prefixes (mirrors `convexProxy` in vite.config.ts). These
      // must reach Vite's proxy middleware, not be answered with index.html.
      const proxyPrefixes = ['/ws_api', '/http_api', '/api'];

      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!req.url) return next();
        const path = req.url.split('?')[0];
        // Only intercept genuine SPA navigations. Everything else — proxied
        // Convex/API traffic, built assets, the WS upgrade, and the other
        // plugins' routes (/status, /branding, /canvas-preview, …) — must fall
        // through. Browser navigations send `Accept: text/html`; XHR/fetch and
        // WS upgrades do not.
        if (proxyPrefixes.some((p) => path === p || path.startsWith(p + '/'))) {
          return next();
        }
        const accept = req.headers['accept'] ?? '';
        if (!accept.includes('text/html')) return next();
        // Anything that looks like a file (has an extension in its last
        // segment) is a built asset — let Vite's static middleware serve it.
        const lastSegment = path.split('/').pop() ?? '';
        if (path !== '/' && lastSegment.includes('.')) return next();

        try {
          template ??= readFileSync(indexPath, 'utf8');
        } catch (err) {
          console.warn('[inject-env] preview: failed to read index.html', err);
          return next();
        }

        const acceptLanguage =
          (Array.isArray(req.headers['accept-language'])
            ? req.headers['accept-language'][0]
            : req.headers['accept-language']) ?? '';
        const html = template
          .replace(
            /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
            envScript,
          )
          .replace(
            "'__ACCEPT_LANGUAGE_PLACEHOLDER__'",
            JSON.stringify(acceptLanguage),
          )
          .replace('<head>', `<head>\n    <base href="${basePath}/">`);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(html);
      });
    },
  };
}
