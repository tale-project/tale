import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail: governance editors must use the centralized skeletonization
 * (`<Skeletonize>` + skeleton-aware leaves, or the `SkeletonBox`/`SkeletonText`
 * primitives for table placeholder rows) — never a hand-rolled skeleton with
 * the bare `<Skeleton>` primitive or magic `h-[…]` heights, and never an
 * `if (isLoading) return <skeleton>` early-return in the render body.
 *
 * This pins the migration: re-introducing the old pattern fails CI. It is a
 * pure source-walk (no DOM), mirroring `lib/i18n/messages.test.ts`.
 */
const COMPONENTS_DIR = dirname(fileURLToPath(import.meta.url));

function listEditorSources(): string[] {
  return readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith('.tsx') &&
        !e.name.endsWith('.test.tsx') &&
        !e.name.endsWith('.stories.tsx'),
    )
    .map((e) => e.name);
}

describe('governance skeleton conventions', () => {
  const files = listEditorSources();

  it('finds the governance editor sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)(
    '%s does not render the bare <Skeleton> primitive (use Skeletonize / SkeletonBox)',
    (name) => {
      const src = readFileSync(join(COMPONENTS_DIR, name), 'utf8');
      // `<Skeleton ` / `<Skeleton>` / `<Skeleton/>` — but NOT <SkeletonBox|Text|ize>.
      const bareSkeletonJsx = /<Skeleton[\s/>]/.test(src);
      expect(
        bareSkeletonJsx,
        `${name} renders a hand-rolled <Skeleton>. Render the real layout inside <Skeletonize loading>; the leaves mask themselves. Use SkeletonBox/SkeletonText only for table placeholder rows.`,
      ).toBe(false);
    },
  );

  it.each(files)('%s does not import the bare Skeleton primitive', (name) => {
    const src = readFileSync(join(COMPONENTS_DIR, name), 'utf8');
    // Importing `Skeleton` (not SkeletonBox/SkeletonText) from the skeleton
    // module signals a hand-rolled skeleton.
    const importsBareSkeleton =
      /import\s*\{[^}]*\bSkeleton\b(?!Box|Text|ize)[^}]*\}\s*from\s*'@tale\/ui\/skeleton'/.test(
        src,
      );
    expect(
      importsBareSkeleton,
      `${name} imports the bare Skeleton primitive. Use Skeletonize (from @tale/ui/skeleton-context) and skeleton-aware leaves instead.`,
    ).toBe(false);
  });

  it.each(files)(
    '%s has no magic h-[…] height on a Skeleton* element',
    (name) => {
      const src = readFileSync(join(COMPONENTS_DIR, name), 'utf8');
      // Catch e.g. `<Skeleton className="h-[100px] …` style magic heights on
      // any Skeleton* element (the sizing should come from the real control).
      const magic = /<Skeleton\w*\b[^>]*className="[^"]*\bh-\[/.test(src);
      expect(
        magic,
        `${name} uses a magic h-[…] height on a Skeleton element. Wrap the real control in <SkeletonBox> so the size comes from the control itself.`,
      ).toBe(false);
    },
  );
});
