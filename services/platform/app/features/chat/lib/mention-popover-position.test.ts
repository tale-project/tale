import { describe, expect, it } from 'vitest';

import {
  computeMentionPopoverPlacement,
  MENTION_POPOVER_ESTIMATED_HEIGHT,
} from './mention-popover-position';

function rect(top: number, height: number, left = 16, width = 400) {
  return { top, bottom: top + height, left, width };
}

describe('computeMentionPopoverPlacement', () => {
  it('opens below when only the lower side has room', () => {
    const placement = computeMentionPopoverPlacement(
      rect(120, 72),
      800,
      MENTION_POPOVER_ESTIMATED_HEIGHT,
    );
    expect(placement.placement).toBe('below');
    expect(placement.top).toBe(120 + 72 + 8);
  });

  it('opens above when only the upper side has room', () => {
    const placement = computeMentionPopoverPlacement(
      rect(600, 72),
      800,
      MENTION_POPOVER_ESTIMATED_HEIGHT,
    );
    expect(placement.placement).toBe('above');
    expect(placement.top).toBe(600 - 8);
  });

  it('prefers below when both sides fit but lower has more room', () => {
    const placement = computeMentionPopoverPlacement(
      rect(200, 72),
      800,
      MENTION_POPOVER_ESTIMATED_HEIGHT,
    );
    expect(placement.placement).toBe('below');
  });

  it('prefers above when neither side fully fits but upper has more room', () => {
    const placement = computeMentionPopoverPlacement(
      rect(150, 48),
      220,
      MENTION_POPOVER_ESTIMATED_HEIGHT,
    );
    expect(placement.placement).toBe('above');
    expect(placement.left).toBe(16);
    expect(placement.width).toBe(400);
  });
});
