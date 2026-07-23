import { describe, expect, it } from 'vitest';

import { computeMinimapDimensions } from './workflow-minimap-dimensions';

describe('computeMinimapDimensions', () => {
  it('sizes a compact MiniMap on a phone-width canvas', () => {
    expect(computeMinimapDimensions(375, 600)).toEqual({
      width: 68,
      height: 109,
    });
  });

  it('sizes a compact MiniMap on a chat-squeezed desktop canvas', () => {
    expect(computeMinimapDimensions(400, 512)).toEqual({
      width: 72,
      height: 92,
    });
  });

  it('sizes proportionally on a wide canvas', () => {
    const dims = computeMinimapDimensions(900, 600);
    expect(dims).toEqual({ width: 162, height: 108 });
  });

  it('caps height below the old 200px max on a tall over-threshold canvas', () => {
    const dims = computeMinimapDimensions(500, 900);
    expect(dims).toEqual({ width: 90, height: 160 });
  });

  it('returns null for zero-sized containers', () => {
    expect(computeMinimapDimensions(0, 600)).toBeNull();
    expect(computeMinimapDimensions(600, 0)).toBeNull();
  });
});
