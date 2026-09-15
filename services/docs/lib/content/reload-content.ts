import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EnvironmentModuleNode, Plugin } from 'vite';

/** The route loader owns the lazy Markdown cache. React Fast Refresh alone
 * resets that cache without rerunning the route, leaving a title and no body.
 * A content edit needs a fresh route load, including after manifest generation. */
export function reloadDocsContent(
  contentRoot = fileURLToPath(new URL('../../../../docs/', import.meta.url)),
  manifestPath = fileURLToPath(
    new URL('../../app/content/frontmatter.json', import.meta.url),
  ),
) {
  const root = path.resolve(contentRoot) + path.sep;
  const manifest = path.resolve(manifestPath);
  return {
    name: 'tale-docs-content-reload',
    apply: 'serve',
    hotUpdate({ file, modules, timestamp }) {
      if (this.environment.name !== 'client') return;
      const changed = path.resolve(file);
      if (changed !== manifest && !changed.startsWith(root)) return;
      const invalidated = new Set<EnvironmentModuleNode>();
      for (const module of modules) {
        this.environment.moduleGraph.invalidateModule(
          module,
          invalidated,
          timestamp,
          true,
        );
      }
      this.environment.hot.send({ type: 'full-reload' });
      return [];
    },
  } satisfies Plugin;
}
