import { describe, expect, it, vi } from 'vitest';

import { busyButton } from './busy-button';

describe('busyButton', () => {
  it('lets the button be pressed while nothing is under way', () => {
    const press = vi.fn();
    const props = busyButton(false, press);
    expect(props['aria-busy']).toBeUndefined();
    expect(props['aria-disabled']).toBeUndefined();
    props.onClick?.();
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('marks it busy and off, and ignores a press, while the work is under way', () => {
    const press = vi.fn();
    const props = busyButton(true, press);
    expect(props['aria-busy']).toBe(true);
    expect(props['aria-disabled']).toBe(true);
    expect(props.onClick).toBeUndefined();
  });
});
