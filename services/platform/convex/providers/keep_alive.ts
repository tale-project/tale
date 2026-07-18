'use node';

/**
 * Keep TLS connections from the node executor alive ACROSS turns.
 *
 * Node's default fetch dispatcher idles keep-alive sockets out after ~4s;
 * chat turns are usually farther apart, so every turn paid a fresh TCP+TLS
 * handshake to the LLM provider (~60–250ms to openrouter.ai measured on the
 * chat hot path). Installing one global dispatcher with a longer idle window
 * lets consecutive turns — and every other outbound fetch in the executor
 * (title generation, embeddings, moderation) — reuse connections. undici's
 * `setGlobalDispatcher` shares the `Symbol.for('undici.globalDispatcher.1')`
 * registry with Node's built-in fetch, so the global `fetch` honors it.
 *
 * This module is 'use node' and imports the `undici` package (declared in
 * `convex.json` `node.externalPackages` — it must NOT be bundled: its internals
 * require `node:` builtins the V8 bundler can't resolve). Keep it out of any
 * import chain reachable from V8 functions; entry-point node actions (e.g.
 * `agents/chat_turn_generate.ts`) call {@link ensureProviderKeepAlive} once.
 * The executor is a single persistent process, so the dispatcher spans
 * invocations and is torn down with the process on deploy/restart.
 */

import { Agent, setGlobalDispatcher } from 'undici';

let installed = false;

export function ensureProviderKeepAlive(): void {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(
    new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 300_000,
    }),
  );
}
