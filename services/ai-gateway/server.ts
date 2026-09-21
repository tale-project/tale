// Bun server: serves the prebuilt SPA from `./dist` via the shared
// React-server pipeline from `@tale/ui/server` (static serving,
// `/api/health`, security headers), with the gateway's own API mounted
// ahead of it and the background token refresh running for the process's
// lifetime.
//
// The panel is one untranslated tree served at the origin root, so locale
// routing is off: a gateway has no public URLs to negotiate, and the person
// picks their language in the panel itself.

import { resolve } from 'node:path';

import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/ui/server';

import { ConfigError } from './backend/config';
import { createGateway } from './backend/gateway';

let gateway;
try {
  gateway = createGateway();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[ai-gateway] ${error.message}`);
    process.exit(1);
  }
  throw error;
}

// Runs for the process's lifetime. The interval is `unref`'d, so it never
// holds the process open, and every write is atomic — there is nothing to
// flush on the way out, and no signal handler of our own to install.
gateway.startRefreshLoop();

startReactServer({
  port: Number(process.env.PORT ?? 3004),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'ai-gateway',
  localeRouting: 'none',
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  extraRoutes: (request, url) => gateway.dispatch(request, url),
});
