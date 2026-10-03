import { readFile } from 'node:fs/promises';

import type { Plugin } from 'vite';

import { parseMarketingContent } from './parse';

/** Transform metadata and each lazy body separately. Metadata imports never
 * contain Markdown bodies or a runtime YAML parser. */
export function marketingContentImports(): Plugin {
  let development = false;
  return {
    name: 'tale-web:marketing-content',
    enforce: 'pre',
    configResolved(config) {
      development = config.command === 'serve';
    },
    async load(id, options) {
      const match = /^(.*\.md)\?marketing-(meta|body)$/.exec(id);
      if (!match) return null;
      this.addWatchFile(match[1]);
      const { content, ...metadata } = parseMarketingContent(
        await readFile(match[1], 'utf8'),
        match[1],
      );
      if (match[2] === 'meta')
        return `export default ${JSON.stringify(metadata)};`;
      if (!development && metadata.frontmatter.draft)
        return 'export default "";';
      if (development || options?.ssr)
        return `export default ${JSON.stringify(content)};`;
      const reference = this.emitFile({
        type: 'asset',
        name: `${metadata.category}-${metadata.locale}-${metadata.slug}.md`,
        source: content,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
