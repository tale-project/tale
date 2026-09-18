import { describe, expect, it } from 'vitest';

import { folderPathLabels } from './document-move-dialog';

/**
 * The move picker is a flat list, so a label has to say which folder it
 * means. Two folders can legitimately share a name under different parents,
 * and the list is drawn from what the caller can see — which can be missing
 * an ancestor.
 */
describe('folderPathLabels', () => {
  it('names a top-level folder by itself', () => {
    const labels = folderPathLabels([{ _id: 'a', name: 'Product Documents' }]);
    expect(labels.get('a')).toBe('Product Documents');
  });

  it('spells out the path so two folders sharing a name stay apart', () => {
    const labels = folderPathLabels([
      { _id: 'product', name: 'Product' },
      { _id: 'sales', name: 'Sales' },
      { _id: 'p-specs', name: 'Specs', parentId: 'product' },
      { _id: 's-specs', name: 'Specs', parentId: 'sales' },
    ]);
    expect(labels.get('p-specs')).toBe('Product / Specs');
    expect(labels.get('s-specs')).toBe('Sales / Specs');
    expect(labels.get('p-specs')).not.toBe(labels.get('s-specs'));
  });

  it('builds the whole chain, not just one level', () => {
    const labels = folderPathLabels([
      { _id: 'a', name: 'A' },
      { _id: 'b', name: 'B', parentId: 'a' },
      { _id: 'c', name: 'C', parentId: 'b' },
    ]);
    expect(labels.get('c')).toBe('A / B / C');
  });

  it('keeps a folder whose parent is not in the list', () => {
    // The caller can see the child but not the ancestor; dropping it would
    // hide a destination they are allowed to move into.
    const labels = folderPathLabels([
      { _id: 'orphan', name: 'Specs', parentId: 'unseen' },
    ]);
    expect(labels.get('orphan')).toBe('Specs');
  });

  it('terminates on a parent cycle instead of spinning', () => {
    const labels = folderPathLabels([
      { _id: 'x', name: 'X', parentId: 'y' },
      { _id: 'y', name: 'Y', parentId: 'x' },
    ]);
    expect(labels.get('x')).toBeDefined();
    expect(labels.get('y')).toBeDefined();
  });
});
