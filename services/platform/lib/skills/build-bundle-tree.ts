/**
 * Build a recursive directory tree from a flat list of bundle asset paths.
 *
 * Replaces the shallow single-level grouping (`groupAssetsByDir`) — Office
 * skills like `pptx` nest XSDs six levels deep
 * (`scripts/office/schemas/ISO-IEC29500-4_2016/sml.xsd`), and a flat
 * grouping would render them as unreadable wall-of-paths under `scripts/`.
 *
 * Sort order within each level: directories first, then files, both
 * alphabetical. Matches conventional file-tree UIs.
 */
export interface BundleTreeNode {
  /** Last path segment, e.g. `"sml.xsd"` or `"ISO-IEC29500-4_2016"`. */
  name: string;
  /** Full path from skill root, e.g. `"scripts/office/schemas"`. */
  path: string;
  kind: 'dir' | 'file';
  /** File-only — size in bytes. */
  size?: number;
  /** Dir-only — sorted children. */
  children?: BundleTreeNode[];
}

interface MutableDirNode {
  name: string;
  path: string;
  kind: 'dir';
  children: BundleTreeNode[];
  childIndex: Map<string, MutableDirNode>;
}

export function buildBundleTree(
  assets: ReadonlyArray<{ path: string; size: number }>,
): BundleTreeNode[] {
  const root: MutableDirNode = {
    name: '',
    path: '',
    kind: 'dir',
    children: [],
    childIndex: new Map(),
  };

  for (const asset of assets) {
    const segments = asset.path.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      let dir = cursor.childIndex.get(seg);
      if (!dir) {
        dir = {
          name: seg,
          path: cursor.path === '' ? seg : `${cursor.path}/${seg}`,
          kind: 'dir',
          children: [],
          childIndex: new Map(),
        };
        cursor.childIndex.set(seg, dir);
        cursor.children.push(dir);
      }
      cursor = dir;
    }

    const fileName = segments[segments.length - 1];
    cursor.children.push({
      name: fileName,
      path: asset.path,
      kind: 'file',
      size: asset.size,
    });
  }

  sortChildren(root.children);
  return root.children;
}

function sortChildren(nodes: BundleTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of nodes) {
    if (child.kind === 'dir' && child.children) {
      sortChildren(child.children);
    }
  }
}

/**
 * Walk the tree and collect every directory path. Used as the default
 * "all expanded" set when no persisted expansion state exists.
 */
export function collectDirPaths(
  nodes: ReadonlyArray<BundleTreeNode>,
): string[] {
  const out: string[] = [];
  function visit(n: BundleTreeNode): void {
    if (n.kind !== 'dir' || !n.children) return;
    out.push(n.path);
    for (const c of n.children) visit(c);
  }
  for (const n of nodes) visit(n);
  return out;
}
