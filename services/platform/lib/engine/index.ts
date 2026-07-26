/**
 * The automation engine — the few names hosts assemble against as one module.
 *
 * Deliberately narrow: a host installs the slots it needs (`setCodeRunner`
 * plus whatever capability node types it registers), validates documents, and
 * executes them. Everything else — the store adapters, the repair helpers,
 * the catalog search, the dispatch surface — is imported from its own module
 * by the one consumer that needs it, so this file never regrows into a barrel
 * of dead re-exports. The core stays pure: it imports no `node:*`, no Bun
 * globals, and no Convex — the layering is enforced by
 * `selftest/purity.test.ts`.
 */

export { nodeTypes, setCodeRunner } from './core/slots';
export { validate } from './core/validate';
export { execute } from './core/execute';
