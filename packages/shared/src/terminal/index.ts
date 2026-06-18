/**
 * `@tale/shared/terminal` — the node-free terminal core.
 *
 * Capability detection, the safe-ANSI vocabulary, the wide-char width algorithm,
 * and pure formatters. NOTHING here value-imports a `node:*` module or `Bun`, so
 * the whole subpath stays reachable from the Convex V8 bundler. The line
 * classifiers live in `@tale/shared/classify` and the process supervisor in
 * `@tale/shared/process`; neither may be imported from here. A boundary test
 * enforces this.
 */

export {
  type Capabilities,
  type CapabilityEnv,
  detectCapabilities,
} from './capabilities';

export {
  ESC,
  makeMarkers,
  makePalette,
  type Markers,
  matchAnsiAt,
  type Palette,
  RESET,
  stripAnsi,
} from './ansi';

export { truncate, visibleWidth } from './width';

export { formatElapsed, padCell } from './format';
