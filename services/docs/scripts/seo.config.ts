/**
 * Build-time SEO config for the docs site. Consumed by
 * `tale-seo-compile` (`@tale/seo/bin/compile`) during the Docker builder
 * stage to materialise `dist-seo/`.
 *
 * Bodies are inline (the disk walk produces them), so this config does
 * not need a separate `loadBody` — `buildDocsCompileParams` already
 * wires one through.
 */

import { buildDocsCompileParams } from '../lib/seo/build';

export default buildDocsCompileParams;
