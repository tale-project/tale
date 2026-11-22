import type { serve as honoServe, ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { RELAY_POT_PATH } from '../../core/video_links/relay.ts';
import { createVideoPotRelayRoutes } from '../video_links/pot-relay-routes.ts';
import { relayDeps } from './deps.ts';
import { type RelayListenEnv, relayListenAddress } from './listener.ts';
import { createRelayHandler } from './server.ts';

/**
 * Start the model relay's listener (tale-project/tale#4942) beside the API,
 * in a process that serves HTTP: on its own port, where only sandbox
 * sessions reach it (`listener.ts`). It answers a harness's model calls
 * and a video job's PO-token relay; the video proxy relay hooks its server
 * (main.ts) — the sandbox's ways out to the platform's providers, kept off
 * the API's listener. A container that cannot bind where it must fails its
 * start, so a deployment hears of it at once rather than at its first agent
 * turn.
 */
export function startModelRelay(args: {
  sql: Sql;
  serve: typeof honoServe;
  env: RelayListenEnv & { SANDBOX_RELAY_PORT: number };
  serverOptions: Parameters<typeof honoServe>[0]['serverOptions'];
}): ServerType {
  const address = relayListenAddress(args.env);
  if ('error' in address) {
    throw new Error(`[llm-relay] cannot start: ${address.error}`);
  }
  const handle = createRelayHandler(relayDeps(args.sql));
  const app = new Hono();
  // The PO-token provider, for a yt-dlp that runs in a sandbox session.
  app.route(RELAY_POT_PATH, createVideoPotRelayRoutes());
  app.all('*', (c) => handle(c.req.raw));
  return args.serve(
    {
      fetch: app.fetch,
      port: args.env.SANDBOX_RELAY_PORT,
      ...(address.host !== undefined ? { hostname: address.host } : {}),
      ...(args.serverOptions !== undefined
        ? { serverOptions: args.serverOptions }
        : {}),
    },
    (info) => {
      console.log(
        `[backend] model relay listening on :${info.port}, reachable from ${address.reach}`,
      );
    },
  );
}
