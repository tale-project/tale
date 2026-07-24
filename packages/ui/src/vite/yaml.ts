import type { Plugin } from 'vite';
import { parse } from 'yaml';

/**
 * Import `.yml`/`.yaml` files as parsed data (default export) — the i18n
 * message catalogs and any other own-format YAML a service imports at build
 * time. Registered by every service's vite config (vitest inherits it), so
 * one plugin serves app code, SSR/prerender, and test runs alike.
 *
 * Parsing happens once at transform time; the emitted module is plain JSON,
 * so the runtime bundle carries no YAML parser.
 */
export function yamlImports(): Plugin {
  return {
    name: 'tale:yaml-imports',
    transform(code, id) {
      if (!/\.ya?ml(\?.*)?$/.test(id)) return null;
      // Idempotent: a `.yml` id can pass through two instances of this plugin
      // when a Storybook build both inherits the app's vite config AND gets
      // the shared `defineStorybookMain` copy. The first turns YAML into an
      // `export default` module; the second must not re-parse that JS as
      // YAML. Skip anything already transformed.
      if (/^\s*export default\b/.test(code)) return null;
      return {
        code: `export default ${JSON.stringify(parse(code))};`,
        map: null,
      };
    },
  };
}
