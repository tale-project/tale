import { describe, expect, it } from 'vitest';

import { tabTarget } from './tab-keys';

describe('tabTarget', () => {
  it('moves to the neighbour with the arrow keys', () => {
    expect(tabTarget('ArrowRight', 1, 4)).toBe(2);
    expect(tabTarget('ArrowLeft', 2, 4)).toBe(1);
  });

  it('goes round the end', () => {
    expect(tabTarget('ArrowRight', 3, 4)).toBe(0);
    expect(tabTarget('ArrowLeft', 0, 4)).toBe(3);
  });

  it('stays on a single tab', () => {
    expect(tabTarget('ArrowRight', 0, 1)).toBe(0);
    expect(tabTarget('ArrowLeft', 0, 1)).toBe(0);
  });

  it('goes to the ends with Home and End', () => {
    expect(tabTarget('Home', 2, 5)).toBe(0);
    expect(tabTarget('End', 2, 5)).toBe(4);
  });

  it('leaves every other key alone, and a strip without tabs', () => {
    expect(tabTarget('Enter', 1, 3)).toBeNull();
    expect(tabTarget('ArrowDown', 1, 3)).toBeNull();
    expect(tabTarget('ArrowRight', 0, 0)).toBeNull();
  });
});
