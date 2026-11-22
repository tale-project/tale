import type { serve as honoServe, ServerType } from '@hono/node-server';
import type { Sql } from 'postgres';

import { relayDeps } from './deps.ts';
import { type RelayListenEnv, relayListenAddress } from './listener.ts';
import { createRelayHandler } from './server.ts';

/**
 * Start the model relay's listener (tale-project/tale#4942) beside the API,
 * in a process that serves HTTP: on its own port, where only sandbox
 * sessions reach it (`listener.ts`). A container that cannot bind where it
 * must fails its start, so a deployment hears of it at once rather than at
 * its first agent turn.
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
  return args.serve(
    {
      fetch: (request) => handle(request),
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
