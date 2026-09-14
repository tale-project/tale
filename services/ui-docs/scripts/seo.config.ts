/**
 * Build-time SEO config. Consumed by `tale-seo-compile`
 * (`@tale/ui/bin/seo-compile.ts`) during the Docker builder stage to
 * materialise `dist-seo/`, which the runtime image serves through
 * `createPrecompiledServer` — so no markdown is read at request time.
 */

import { buildUiDocsCompileParams } from '../lib/seo/build';

export default buildUiDocsCompileParams;
