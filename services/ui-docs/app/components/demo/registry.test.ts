import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { allDemoNames, getDemoComponent, loadDemoSource } from './registry';

/**
 * The registry is two `import.meta.glob`s over one tree — eager components so
 * a demo lands in the prerendered HTML, lazy sources so the Code panel costs
 * nothing until it is opened. This suite pins them to the tree itself: a demo
 * that exists on disk but not in the registry would render the error box on a
 * live page, and the two globs drifting apart would give a preview with no
 * source behind it.
 *
 * `tests/demos.test.ts` owns the other half — that the pages and the tree
 * agree. It runs in the node environment, where the eager glob would pull all
 * of `@tale/ui` in, so the registry itself is checked here instead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMOS_ROOT = resolve(HERE, '..', '..', 'demos');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.tsx')) yield full;
  }
}

async function demoNamesOnDisk(): Promise<string[]> {
  const out: string[] = [];
  for await (const filePath of walk(DEMOS_ROOT)) {
    out.push(relative(DEMOS_ROOT, filePath).replace(/\.tsx$/, ''));
  }
  return out.sort();
}

const KNOWN = 'button/variants';
const UNKNOWN = 'button/there-is-no-such-demo';

describe('allDemoNames', () => {
  it('registers every demo file on disk, and nothing else', async () => {
    expect(allDemoNames()).toEqual(await demoNamesOnDisk());
  });
});

describe('getDemoComponent', () => {
  it('resolves the component a page addresses by name', () => {
    expect(getDemoComponent(KNOWN)).toBeTypeOf('function');
  });

  it('is undefined for an unknown name, so the caller can say so', () => {
    expect(getDemoComponent(UNKNOWN)).toBeUndefined();
  });
});

describe('loadDemoSource', () => {
  it('loads the raw source behind every registered name', async () => {
    const source = await loadDemoSource(KNOWN);
    expect(source).toContain('export default function ButtonVariants');
  });

  it('is null for an unknown name', async () => {
    expect(await loadDemoSource(UNKNOWN)).toBeNull();
  });
});
