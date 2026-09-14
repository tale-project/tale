import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listAllContent } from '@/scripts/walk-content';

/**
 * Demo parity, the contract `content/README.md` promises: a page never points
 * at a demo that does not exist, and a demo file is never orphaned. Both
 * halves matter — a missing demo renders the `role="alert"` error box on a
 * live page, and an unreferenced demo is dead code that still ships in the
 * eager registry glob (and therefore in every reader's bundle).
 *
 * The walk reads the real trees rather than the registry, because the
 * registry's `import.meta.glob` would pull every demo component — and with
 * it all of `@tale/ui` — into a node-environment test run.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMOS_ROOT = resolve(HERE, '..', 'app', 'demos');

/** `<Demo name="button/variants" />` — the one tag this site adds. */
const DEMO_TAG = /<Demo\s[^>]*name="([^"]*)"/g;

/** `<family>/<name>`, both dash-case: the on-disk layout under `app/demos/`. */
const DEMO_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A CSS hex colour in any of its four lengths. Demos are the worked example of
 * the token rules the pages describe, so a literal colour in one contradicts
 * the page it illustrates.
 */
const HEX_COLOUR =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/** Drop line and block comments so a hex value named in prose is not a finding. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function* walkDemoFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDemoFiles(full);
    else if (entry.name.endsWith('.tsx')) yield full;
  }
}

/** Every demo name on disk, in stable order. */
async function listDemoFiles(): Promise<{ name: string; filePath: string }[]> {
  const out: { name: string; filePath: string }[] = [];
  for await (const filePath of walkDemoFiles(DEMOS_ROOT)) {
    out.push({
      name: relative(DEMOS_ROOT, filePath).replace(/\.tsx$/, ''),
      filePath,
    });
  }
  return out.toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Every `<Demo name>` a page references, with the page it came from. */
async function listDemoReferences(): Promise<{ name: string; slug: string }[]> {
  const records = await listAllContent();
  return records.flatMap((record) =>
    [...record.body.matchAll(DEMO_TAG)].map((match) => ({
      name: match[1],
      slug: record.slug,
    })),
  );
}

const demoFiles = await listDemoFiles();
const demoReferences = await listDemoReferences();
const demoNames = new Set(demoFiles.map((demo) => demo.name));

describe('demo registry', () => {
  it('has demos on disk to check', () => {
    expect(demoFiles.length).toBeGreaterThan(0);
    expect(demoReferences.length).toBeGreaterThan(0);
  });

  it('every <Demo name> resolves to app/demos/<name>.tsx', () => {
    const unresolved = demoReferences
      .filter((reference) => !demoNames.has(reference.name))
      .map((reference) => `${reference.slug}: <Demo name="${reference.name}">`);
    expect(unresolved, 'demo references with no file').toEqual([]);
  });

  it('every demo file is referenced by at least one page', () => {
    const referenced = new Set(demoReferences.map((r) => r.name));
    const orphans = demoFiles
      .map((demo) => demo.name)
      .filter((name) => !referenced.has(name));
    expect(orphans, 'demo files no page references').toEqual([]);
  });

  it('every demo name is <family>/<name> in dash-case', () => {
    const malformed = demoFiles
      .map((demo) => demo.name)
      .filter((name) => !DEMO_NAME.test(name));
    expect(
      malformed,
      'demo paths outside app/demos/<family>/<name>.tsx',
    ).toEqual([]);
  });
});

describe('demo source', () => {
  it('default-exports a component', async () => {
    const findings: string[] = [];
    for (const demo of demoFiles) {
      const source = await readFile(demo.filePath, 'utf-8');
      if (!/^export default function\s/m.test(source)) {
        findings.push(demo.name);
      }
    }
    expect(findings, 'demos with no default-exported component').toEqual([]);
  });

  it('uses tokens, never a raw hex colour', async () => {
    const findings: string[] = [];
    for (const demo of demoFiles) {
      const source = stripComments(await readFile(demo.filePath, 'utf-8'));
      for (const match of source.matchAll(HEX_COLOUR)) {
        findings.push(`${demo.name}: ${match[0]}`);
      }
    }
    expect(findings, 'raw hex colours in demo files').toEqual([]);
  });
});
