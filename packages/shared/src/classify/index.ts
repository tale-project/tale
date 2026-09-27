/**
 * `@tale/shared/classify` — the node-free line-classification layer that turns
 * raw subprocess spew into clean output. A pure text→verdict layer: it has
 * nothing to do with terminal capability or rendering, so it lives apart from
 * `@tale/shared/terminal`. `tale dev`, `tale logs` and the platform's dev
 * orchestrator classify their subprocess output through it; the Convex V8
 * bundler can reach it, so NOTHING here value-imports a `node:*` module or
 * `Bun`. A boundary test enforces this.
 */

export {
  type ClassifiedLine,
  type Classifier,
  type LineKind,
  type LineSource,
  noise,
  type ProgressStatus,
} from './kinds';

export { classifyDockerCompose } from './sources/docker-compose';
export { classifyBuildKit } from './sources/buildkit';
export { classifyBackend } from './sources/backend';
export { classifyVite } from './sources/vite';
export { classifyPlatformContainer } from './sources/platform-container';

export { chain, createStreamClassifier } from './combinators';
