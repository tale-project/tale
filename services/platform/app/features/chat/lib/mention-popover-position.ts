/** Rough height of the mention listbox (header + max-h-64 body + padding). */
export const MENTION_POPOVER_ESTIMATED_HEIGHT = 288;

export interface MentionPopoverCoords {
  left: number;
  top: number;
  /** Anchor width — callers may use this as a min-width hint. */
  width: number;
  placement: 'above' | 'below';
}

/**
 * Pick above/below placement for a mention popover anchored to a composer
 * textarea. Prefers the side with more viewport room; when space is tight on
 * both sides, still picks the larger side so the list can scroll internally.
 */
export function computeMentionPopoverPlacement(
  anchorRect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
  viewportHeight: number,
  estimatedHeight = MENTION_POPOVER_ESTIMATED_HEIGHT,
): MentionPopoverCoords {
  const spaceAbove = anchorRect.top;
  const spaceBelow = viewportHeight - anchorRect.bottom;
  const fitsAbove = spaceAbove >= estimatedHeight;
  const fitsBelow = spaceBelow >= estimatedHeight;

  let placement: 'above' | 'below';
  if (fitsBelow && !fitsAbove) {
    placement = 'below';
  } else if (fitsAbove && !fitsBelow) {
    placement = 'above';
  } else {
    placement = spaceBelow >= spaceAbove ? 'below' : 'above';
  }

  return {
    left: anchorRect.left,
    width: anchorRect.width,
    top: placement === 'below' ? anchorRect.bottom + 8 : anchorRect.top - 8,
    placement,
  };
}
