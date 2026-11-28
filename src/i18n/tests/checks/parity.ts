/**
 * Parity adapter — wraps the existing `defineMessagesParityTests` so it
 * participates in the new registry. The check itself runs inside its own
 * `describe`/`it` blocks via the existing module; the wrapper exists so
 * mode dispatch and inventory listing stay uniform.
 */

import { defineMessagesParityTests } from '../parity';
import { createCheck } from './types';

export const parity = createCheck({
  id: 'parity',
  scope: 'json',
  defaultMode: 'enforce',
  run(ctx) {
    if (!ctx.messagesDir) return [];
    // The existing module registers `describe`/`it` blocks directly. Calling
    // it here at register time emits the parity tests. Findings flow through
    // vitest's `expect`; the check returns `[]` so `assertFindings` is a
    // no-op for this id.
    defineMessagesParityTests({
      messagesDir: ctx.messagesDir,
    });
    return [];
  },
});
