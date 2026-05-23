#!/usr/bin/env bun
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * One-shot codemod: rewrite imports from platform UI primitive paths to the
 * canonical `@tale/ui/<name>` subpath exports after a wave of component
 * migrations.
 *
 * Usage:
 *   bun services/platform/scripts/codemod-ui-imports.ts            # apply
 *   bun services/platform/scripts/codemod-ui-imports.ts --dry-run  # report only
 *
 * Drives off a static MAPPING table — extend it per wave of the migration
 * plan. Each entry is a literal `from '...'` source path on the left, and the
 * `@tale/ui/<name>` target on the right.
 *
 * The replacements only touch the module specifier on `import …` and
 * `export … from` lines, preserving quote style (single or double), type-only
 * imports, and grouped imports.
 */
import { Glob } from 'bun';

const MAPPING: Record<string, string> = {
  // Wave 1
  '@/app/components/ui/layout/layout': '@tale/ui/layout',
  '@/app/components/ui/typography/text': '@tale/ui/text',
  '@/app/components/ui/typography/heading': '@tale/ui/heading',
  // Wave 2 — feedback primitives
  '@/app/components/ui/feedback/alert': '@tale/ui/alert',
  '@/app/components/ui/feedback/empty-state': '@tale/ui/empty-state',
  '@/app/components/ui/feedback/empty-placeholder':
    '@tale/ui/empty-placeholder',
  '@/app/components/ui/feedback/loading-overlay': '@tale/ui/loading-overlay',
  '@/app/components/ui/feedback/progress-bar': '@tale/ui/progress-bar',
  // Wave 2 — layout primitives
  '@/app/components/ui/layout/card': '@tale/ui/card',
  '@/app/components/ui/layout/action-row': '@tale/ui/action-row',
  '@/app/components/ui/layout/full-page-center': '@tale/ui/full-page-center',
  '@/app/components/ui/layout/page-section': '@tale/ui/page-section',
  '@/app/components/ui/layout/bordered-section': '@tale/ui/bordered-section',
  '@/app/components/ui/layout/section-header': '@tale/ui/section-header',
  '@/app/components/ui/layout/sticky-section-header':
    '@tale/ui/sticky-section-header',
  // Wave 2 — overlays
  '@/app/components/ui/overlays/popover': '@tale/ui/popover',
  '@/app/components/ui/overlays/dropdown-menu': '@tale/ui/dropdown-menu',
  // Wave 2 — navigation primitives
  '@/app/components/ui/navigation/tabs': '@tale/ui/tabs',
  '@/app/components/ui/navigation/collapsible-details':
    '@tale/ui/collapsible-details',
  // Wave 2 — data-display primitives
  '@/app/components/ui/data-display/inline-code': '@tale/ui/inline-code',
  '@/app/components/ui/data-display/stat-grid': '@tale/ui/stat-grid',
  '@/app/components/ui/data-display/stat-item': '@tale/ui/stat-item',
  '@/app/components/ui/data-display/selectable-row': '@tale/ui/selectable-row',
  '@/app/components/ui/data-display/table': '@tale/ui/table',
  '@/app/components/ui/data-display/code-block': '@tale/ui/code-block',
  '@/app/components/ui/forms/description': '@tale/ui/description',
  // Relative imports between sibling files in `components/ui/` —
  // the codemod runs across `services/platform/app`, so the relative
  // paths are well-defined.
  '../layout/layout': '@tale/ui/layout',
  '../typography/text': '@tale/ui/text',
  '../typography/heading': '@tale/ui/heading',
  '../feedback/alert': '@tale/ui/alert',
  '../feedback/empty-state': '@tale/ui/empty-state',
  '../feedback/empty-placeholder': '@tale/ui/empty-placeholder',
  '../feedback/loading-overlay': '@tale/ui/loading-overlay',
  '../feedback/progress-bar': '@tale/ui/progress-bar',
  '../layout/card': '@tale/ui/card',
  '../layout/action-row': '@tale/ui/action-row',
  '../layout/full-page-center': '@tale/ui/full-page-center',
  '../layout/page-section': '@tale/ui/page-section',
  '../layout/bordered-section': '@tale/ui/bordered-section',
  '../layout/section-header': '@tale/ui/section-header',
  '../layout/sticky-section-header': '@tale/ui/sticky-section-header',
  '../overlays/popover': '@tale/ui/popover',
  '../overlays/dropdown-menu': '@tale/ui/dropdown-menu',
  '../navigation/tabs': '@tale/ui/tabs',
  '../navigation/collapsible-details': '@tale/ui/collapsible-details',
  '../data-display/inline-code': '@tale/ui/inline-code',
  '../data-display/stat-grid': '@tale/ui/stat-grid',
  '../data-display/stat-item': '@tale/ui/stat-item',
  '../data-display/selectable-row': '@tale/ui/selectable-row',
  '../data-display/table': '@tale/ui/table',
  '../data-display/code-block': '@tale/ui/code-block',
  '../forms/description': '@tale/ui/description',
  './description': '@tale/ui/description',
};

const ROOTS = [
  'services/platform/app',
  'services/platform/lib',
  'services/platform/test',
];

const DRY_RUN = process.argv.includes('--dry-run');

interface Stats {
  filesScanned: number;
  filesChanged: number;
  occurrencesRewritten: number;
}

function rewriteSource(content: string): {
  next: string;
  occurrences: number;
} {
  let occurrences = 0;
  let next = content;
  for (const [from, to] of Object.entries(MAPPING)) {
    // Match `from 'x'` and `from "x"` only — never bare string literals.
    const pattern = new RegExp(`(from\\s+)(['"])${escapeRegex(from)}\\2`, 'g');
    next = next.replace(pattern, (_match, prefix, quote) => {
      occurrences += 1;
      return `${prefix}${quote}${to}${quote}`;
    });
  }
  return { next, occurrences };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const stats: Stats = {
    filesScanned: 0,
    filesChanged: 0,
    occurrencesRewritten: 0,
  };
  const cwd = process.cwd();

  for (const root of ROOTS) {
    const glob = new Glob('**/*.{ts,tsx}');
    for await (const relative of glob.scan({ cwd: resolve(cwd, root) })) {
      const absolute = resolve(cwd, root, relative);
      stats.filesScanned += 1;
      const content = await readFile(absolute, 'utf8');
      const { next, occurrences } = rewriteSource(content);
      if (occurrences === 0) continue;
      stats.filesChanged += 1;
      stats.occurrencesRewritten += occurrences;
      if (!DRY_RUN) {
        await writeFile(absolute, next, 'utf8');
      }
    }
  }

  const verb = DRY_RUN ? 'Would rewrite' : 'Rewrote';
  console.log(
    `${verb} ${stats.occurrencesRewritten} import(s) across ${stats.filesChanged}/${stats.filesScanned} file(s).`,
  );
}

await main();
