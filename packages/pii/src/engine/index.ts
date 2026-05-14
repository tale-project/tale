/**
 * Engine barrel — convenience re-exports for the `@tale/pii/engine`
 * subpath import. Each consumer can also import the exact module
 * (`@tale/pii/engine/detector` etc.) to avoid pulling unused exports.
 */

export { detectPii, dedupOverlaps } from './detector';
export { maskPii } from './masker';
export {
  createScrubber,
  type Scrubber,
  type ScrubberOptions,
  type PatternToggle,
} from './scrubber';
export { PatternRegistry } from './registry';
