import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';
import { chatShimHandlers } from './shim.ts';

/**
 * The EXHAUSTIVENESS gate for the chat lane's ctx dispatch — the twin of
 * `domains/sandbox/shim.test.ts`, on the same shared walk.
 *
 * `runChatTurn` hands the reused 0.4 `executeTurn` a ctx shim built from
 * `chatShimHandlers` alone, and the shim fails LOUD on a name it has no
 * handler for. A chat turn reaches far more than the host: the three-tool
 * executor's `rag_search` / `rag_fetch` / `web_fetch` legs, the attachment
 * gate, the composer's catalog walk, and the TTS/dictation resolvers all
 * dispatch on this one map. Before this file, `domains/chat/` had no test at
 * all, so an un-shimmed name reached an operator before it reached anyone
 * else.
 *
 * What this gate CANNOT catch is the other half of the same failure: a
 * handler that is present and answers nothing. `kind="website"` and
 * `kind="mail-attachment"` shipped as `async () => []` against tables that
 * existed, and an empty result reads exactly like a real one. That half is
 * covered by the integration checks (`backend/integration-check.ts`), which
 * seed rows and require them back.
 */

/**
 * Where a chat dispatch begins — the reused 0.4 modules each 0.5 host hands
 * this shim to — and the one module it does NOT have to answer.
 *
 * `core/chat/turn_store.ts` is 0.4's Convex-backed `TurnStore` / `UsageLedger`
 * pair. `executeTurn` builds it and then spreads `overrides.deps` over it, and
 * `runChatTurn` always overrides both with the Postgres ports in
 * `domains/chat/store.ts` — so its seven `internal.chat.*` writes are dead
 * code here, not a gap in the map. The exclusion is a hole in this gate, so
 * the test below asserts the override is still wired.
 */
const CHAT_DISPATCH = {
  entryPoints: [
    // The turn itself, and with it the whole tool executor.
    'core/chat/turn_action.ts',
    // The composer's model/voice catalog walk.
    'core/lib/providers/chat_catalog.ts',
    // Voice: TTS synthesis and dictation both resolve their model on this map.
    'core/lib/providers/resolve_tts_model.ts',
    'core/lib/providers/resolve_transcription_model.ts',
  ],
  replacedModules: ['core/chat/turn_store.ts'],
};

describe('chatShimHandlers', () => {
  // The factory only closes over `sql`; no handler runs until it is called,
  // so a stand-in is enough to enumerate the map.
  const handlers = chatShimHandlers({} as never);

  it('answers every internal function a chat turn can reach', () => {
    expect(unansweredHandlerNames(handlers, CHAT_DISPATCH)).toEqual([]);
  });

  it('still replaces the 0.4 turn store the walk excludes', () => {
    // Without the override, `executeTurn` would dispatch the excluded
    // module's writes onto this map — which has no handler for any of them,
    // so every turn would die on its first append. `Partial<TurnDeps>` makes
    // dropping one a type-clean edit, which is why it needs an assertion.
    const service = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.ts'),
      'utf8',
    );
    expect(service).toContain('store: createPgTurnStore(');
    expect(service).toContain('usage: createPgUsageLedger(');
  });

  it('reaches the search legs, not just the turn host', () => {
    // A guard on the guard: if the walk ever stops following the tool
    // executor's imports, the assertion above would pass vacuously — and the
    // legs that shipped dead are exactly the ones behind that edge.
    const reachable = reachableHandlerNames(CHAT_DISPATCH);
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'websites/internal_queries:listWebsiteSummaries',
        'file_metadata/internal_queries:listMailAttachmentsForChat',
        'tasks/search_for_chat:searchTasksForChat',
        'tasks/search_for_chat:searchProjectsForChat',
        'conversations/search_for_chat:searchConversationsForChat',
        'knowledge_entries/internal_queries:listEntriesForAgent',
      ]),
    );
  });
});
