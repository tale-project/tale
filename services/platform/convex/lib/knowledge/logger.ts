/**
 * Logger for the ported knowledge / RAG / crawler logic.
 *
 * Thin binding of the one reusable `@tale/shared` logger to the `knowledge`
 * namespace. Inside a Convex node action there is no long-lived process logger —
 * Convex captures `console.*` into the function logs — so the factory runs in
 * its console-backed mode here. `debug` is gated behind `DEBUG_KNOWLEDGE`.
 */

import { createLogger } from '@tale/shared/logging/logger';

export const logger = createLogger({
  namespace: 'knowledge',
  debugEnvVar: 'DEBUG_KNOWLEDGE',
});
