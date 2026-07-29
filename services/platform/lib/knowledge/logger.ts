/**
 * The knowledge subsystem's logger.
 *
 * A binding of the one shared Tale logger to the `knowledge` namespace. It is
 * `console`-backed and free of Node built-ins, so the same module works inside
 * a Convex V8 function, a Convex node action, and a plain unit test. `debug`
 * lines stay quiet unless `DEBUG_KNOWLEDGE` is set, which is what makes it safe
 * for the per-search diagnostics to be verbose.
 */

import { createLogger } from '@tale/shared/logging/logger';

export const logger = createLogger({
  namespace: 'knowledge',
  debugEnvVar: 'DEBUG_KNOWLEDGE',
});
