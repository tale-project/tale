#!/usr/bin/env bun
// Regenerates regional locale variants (de-AT, de-CH, fr-CH) from their base locale
// (de, de, fr) plus optional per-file overrides in .locale-overrides/<variant>/.

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const DOCS = dirname(currentDir);

type Transform = (content: string) => string;
type Variant = { variant: string; base: string; transforms?: Transform[] };

// Swiss German does not use "ß" — every "ß" becomes "ss". Applied inside prose
// only; code blocks and frontmatter are preserved verbatim.
const swissSpelling: Transform = (content) =>
  transformProse(content, (prose) => prose.replaceAll('ß', 'ss'));

const VARIANTS: readonly Variant[] = [
  { variant: 'de-AT', base: 'de' },
  { variant: 'de-CH', base: 'de', transforms: [swissSpelling] },
  { variant: 'fr-CH', base: 'fr' },
] as const;

// Splits a Markdown document into prose and protected spans (code fences,
// inline code, frontmatter) so mechanical transforms don't corrupt code.
function transformProse(
  content: string,
  fn: (prose: string) => string,
): string {
  // Preserve frontmatter, fenced code blocks, and inline code by splitting on
  // those delimiters and only applying `fn` to the prose segments.
  const pattern = /(^---\n[\s\S]*?\n---\n)|(```[\s\S]*?```)|(`[^`\n]+`)/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    result += fn(content.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = pattern.lastIndex;
  }
  result += fn(content.slice(lastIndex));
  return result;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))
      out.push(full);
  }
  return out;
}

function rewriteLinksForVariant(
  content: string,
  baseLocale: string,
  variant: string,
): string {
  // Rewrite only Markdown link/image destinations — `](...)` — so that code
  // blocks, inline text, and frontmatter values that happen to include the
  // base-locale prefix are left untouched.
  const pattern = new RegExp(`(\\]\\()/${baseLocale}/`, 'g');
  return content.replace(pattern, `$1/${variant}/`);
}

async function generate({
  variant,
  base,
  transforms = [],
}: Variant): Promise<void> {
  const baseDir = join(DOCS, base);
  const variantDir = join(DOCS, variant);
  const overrideDir = join(DOCS, '.locale-overrides', variant);

  if (!existsSync(baseDir)) {
    throw new Error(`Base locale directory missing: ${baseDir}`);
  }

  if (existsSync(variantDir))
    await rm(variantDir, { recursive: true, force: true });
  await mkdir(variantDir, { recursive: true });

  const baseFiles = await walk(baseDir);
  const overrideFiles = existsSync(overrideDir) ? await walk(overrideDir) : [];
  const overrideSet = new Set(
    overrideFiles.map((f) => relative(overrideDir, f).split(sep).join('/')),
  );

  for (const override of overrideSet) {
    const matches = baseFiles.some(
      (b) => relative(baseDir, b).split(sep).join('/') === override,
    );
    if (!matches) {
      throw new Error(
        `Override '${variant}/${override}' has no matching file in base locale '${base}'. ` +
          `Remove the override or add the base file.`,
      );
    }
  }

  let copied = 0;
  let overridden = 0;
  for (const sourceFile of baseFiles) {
    const relPath = relative(baseDir, sourceFile).split(sep).join('/');
    const targetFile = join(variantDir, relPath);
    await mkdir(dirname(targetFile), { recursive: true });

    let content: string;
    if (overrideSet.has(relPath)) {
      content = await readFile(join(overrideDir, relPath), 'utf8');
      overridden++;
    } else {
      content = await readFile(sourceFile, 'utf8');
      copied++;
    }

    content = rewriteLinksForVariant(content, base, variant);
    for (const transform of transforms) content = transform(content);
    await writeFile(targetFile, content);
  }

  console.log(
    `${variant}: ${copied} copied from ${base}, ${overridden} overridden (total ${copied + overridden})`,
  );
}

async function main(): Promise<void> {
  for (const v of VARIANTS) await generate(v);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
