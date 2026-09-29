import { describe, expect, it } from 'vitest';

import {
  buildBundleTree,
  bundleTreeEntryPath,
  collectDirPaths,
  type BundleTreeNode,
} from './build-bundle-tree';

function children(node: BundleTreeNode): BundleTreeNode[] {
  if (!node.children) throw new Error(`expected dir, got file at ${node.path}`);
  return node.children;
}

describe('buildBundleTree', () => {
  it('returns empty array for no assets', () => {
    expect(buildBundleTree([])).toEqual([]);
  });

  it('places root-level files at the top of the result', () => {
    const tree = buildBundleTree([
      { path: 'editing.md', size: 100 },
      { path: 'LICENSE.txt', size: 50 },
    ]);
    // localeCompare folds case → 'e' < 'L' (i.e. editing.md < LICENSE.txt).
    expect(tree.map((n) => n.path)).toEqual(['editing.md', 'LICENSE.txt']);
    expect(tree.every((n) => n.kind === 'file')).toBe(true);
  });

  it('nests directories arbitrarily deep', () => {
    const tree = buildBundleTree([
      {
        path: 'scripts/office/schemas/ISO-IEC29500-4_2016/sml.xsd',
        size: 242277,
      },
    ]);
    expect(tree).toHaveLength(1);
    const scripts = tree[0];
    expect(scripts.kind).toBe('dir');
    expect(scripts.name).toBe('scripts');

    const office = children(scripts)[0];
    expect(office.path).toBe('scripts/office');

    const schemas = children(office)[0];
    expect(schemas.path).toBe('scripts/office/schemas');

    const isoDir = children(schemas)[0];
    expect(isoDir.path).toBe('scripts/office/schemas/ISO-IEC29500-4_2016');

    const sml = children(isoDir)[0];
    expect(sml.kind).toBe('file');
    expect(sml.size).toBe(242277);
    expect(sml.path).toBe('scripts/office/schemas/ISO-IEC29500-4_2016/sml.xsd');
  });

  it('sorts directories before files and alphabetizes within each kind', () => {
    const tree = buildBundleTree([
      { path: 'scripts/zeta.py', size: 1 },
      { path: 'scripts/alpha.py', size: 1 },
      { path: 'scripts/office/pack.py', size: 1 },
      { path: 'scripts/helpers/run.py', size: 1 },
    ]);
    const names = children(tree[0]).map(
      (n) => `${n.name}${n.kind === 'dir' ? '/' : ''}`,
    );
    expect(names).toEqual(['helpers/', 'office/', 'alpha.py', 'zeta.py']);
  });

  it('shares intermediate directories between sibling files', () => {
    const tree = buildBundleTree([
      { path: 'scripts/office/pack.py', size: 1 },
      { path: 'scripts/office/unpack.py', size: 1 },
      { path: 'scripts/office/helpers/run.py', size: 1 },
    ]);
    const office = children(tree[0])[0];
    expect(office.name).toBe('office');
    const childPaths = children(office)
      .map((n) => n.path)
      .sort();
    expect(childPaths).toEqual([
      'scripts/office/helpers',
      'scripts/office/pack.py',
      'scripts/office/unpack.py',
    ]);
  });

  it('mirrors the pptx bundle shape end-to-end', () => {
    const assets = [
      { path: 'pptxgenjs.md', size: 12500 },
      { path: 'editing.md', size: 6700 },
      { path: 'LICENSE.txt', size: 1400 },
      { path: 'scripts/__init__.py', size: 0 },
      { path: 'scripts/add_slide.py', size: 6700 },
      { path: 'scripts/office/pack.py', size: 1000 },
      {
        path: 'scripts/office/schemas/ISO-IEC29500-4_2016/sml.xsd',
        size: 242277,
      },
      {
        path: 'scripts/office/schemas/ISO-IEC29500-4_2016/dml-chart.xsd',
        size: 74984,
      },
    ];
    const tree = buildBundleTree(assets);
    const top = tree.map((n) => n.name);
    // scripts/ dir first; root-level files follow with case-folded
    // localeCompare ordering (editing.md < LICENSE.txt < pptxgenjs.md).
    expect(top).toEqual([
      'scripts',
      'editing.md',
      'LICENSE.txt',
      'pptxgenjs.md',
    ]);

    function findDir(nodes: BundleTreeNode[], name: string): BundleTreeNode {
      const match = nodes.find((n) => n.name === name);
      if (!match) throw new Error(`missing dir ${name}`);
      return match;
    }
    const scripts = findDir(tree, 'scripts');
    const office = findDir(children(scripts), 'office');
    const schemas = findDir(children(office), 'schemas');
    const isoDir = findDir(children(schemas), 'ISO-IEC29500-4_2016');
    expect(children(isoDir).map((n) => n.name)).toEqual([
      'dml-chart.xsd',
      'sml.xsd',
    ]);
  });
});

describe('collectDirPaths', () => {
  it('returns every directory path in document order', () => {
    const tree = buildBundleTree([
      { path: 'scripts/office/pack.py', size: 1 },
      { path: 'scripts/helpers/run.py', size: 1 },
      { path: 'assets/logo.png', size: 1 },
      { path: 'top.md', size: 1 },
    ]);
    expect(collectDirPaths(tree).sort()).toEqual([
      'assets',
      'scripts',
      'scripts/helpers',
      'scripts/office',
    ]);
  });
});

describe('bundleTreeEntryPath', () => {
  const tree = buildBundleTree([
    { path: 'references/notes.txt', size: 1 },
    { path: 'references/nested/inner.txt', size: 1 },
    { path: 'scripts/run.py', size: 1 },
    { path: 'LICENSE.txt', size: 1 },
  ]);
  const all = new Set(collectDirPaths(tree));
  const without = (...dirs: string[]) =>
    new Set([...all].filter((dir) => !dirs.includes(dir)));

  it('is the selected file while it is on screen', () => {
    expect(bundleTreeEntryPath(tree, all, 'references/nested/inner.txt')).toBe(
      'references/nested/inner.txt',
    );
    expect(bundleTreeEntryPath(tree, new Set(), 'LICENSE.txt')).toBe(
      'LICENSE.txt',
    );
  });

  it('is the folder that hides the selected file', () => {
    expect(
      bundleTreeEntryPath(tree, without('references'), 'references/notes.txt'),
    ).toBe('references');
    expect(
      bundleTreeEntryPath(
        tree,
        without('references/nested'),
        'references/nested/inner.txt',
      ),
    ).toBe('references/nested');
  });

  it('is the outermost collapsed folder when several hide it', () => {
    expect(
      bundleTreeEntryPath(
        tree,
        without('references', 'references/nested'),
        'references/nested/inner.txt',
      ),
    ).toBe('references');
  });

  it('falls back to the nearest folder still in the bundle', () => {
    expect(bundleTreeEntryPath(tree, all, 'references/gone.txt')).toBe(
      'references',
    );
  });

  it('is null when no row of the tree qualifies', () => {
    expect(bundleTreeEntryPath(tree, all, null)).toBeNull();
    expect(bundleTreeEntryPath(tree, all, 'SKILL.md')).toBeNull();
    expect(bundleTreeEntryPath(tree, all, 'assets/logo.svg')).toBeNull();
  });
});
