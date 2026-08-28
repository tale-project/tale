/**
 * Node ESM resolve hook for the 0.5 backend runtime.
 *
 * The backend runs as plain `node main.ts` (type-stripped, no bundler), so
 * Node's ESM resolver demands fully-specified relative imports. The 0.4
 * platform tree (`services/platform/lib/**`, reusable pure modules under
 * `services/platform/convex/**`) was written for bundler resolution and uses
 * extensionless relative imports throughout. Rather than fork-copying every
 * pure helper the port reuses (and silently drifting from 0.4 while both
 * trees are live), this hook teaches Node the bundler convention: when a
 * relative/absolute specifier fails to resolve, retry `<specifier>.ts`, then
 * `<specifier>/index.ts`.
 *
 * Registered via `node --import ./backend/node-loader.mjs …` in the backend
 * scripts and the container entrypoint. Package specifiers are never
 * rewritten; `.tsx` is deliberately NOT tried — the backend must never pull
 * UI modules.
 */

import { registerHooks } from 'node:module';

const RETRIABLE = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_UNSUPPORTED_DIR_IMPORT',
]);

function isPathSpecifier(specifier) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/') ||
    specifier.startsWith('file:')
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const code =
        error !== null && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (!RETRIABLE.has(code)) {
        throw error;
      }
      // Bare-specifier deep paths (e.g. `validator/lib/isIBAN`) are CJS files
      // published without an exports map; ESM needs the explicit `.js`.
      const candidates = isPathSpecifier(specifier)
        ? [`${specifier}.ts`, `${specifier}.js`, `${specifier}/index.ts`]
        : specifier.includes('/')
          ? [`${specifier}.js`]
          : [];
      for (const candidate of candidates) {
        try {
          return nextResolve(candidate, context);
        } catch (retryError) {
          console.debug?.(
            `[node-loader] candidate failed: ${candidate} (${String(retryError?.code ?? retryError)})`,
          );
        }
      }
      throw error;
    }
  },
});
