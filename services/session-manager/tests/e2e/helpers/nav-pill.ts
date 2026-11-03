import type { Locator } from '@playwright/test';

export interface PillState {
  /** The highlight lies over the item (within a pixel on every side). */
  onItem: boolean;
  /** 1 when it is drawn, 0 while it fades out or has nowhere to be. */
  opacity: number;
}

/**
 * Where a sliding highlight stands against the item it should mark: the rail's
 * pill under the current section, the panel's highlight under the open row.
 * The highlight glides there over a moment, so poll it (`expect.poll`) until
 * it has arrived and is fully drawn.
 */
export async function pillState(
  pill: Locator,
  item: Locator,
): Promise<PillState> {
  const [pillBox, itemBox] = await Promise.all([
    pill.boundingBox(),
    item.boundingBox(),
  ]);
  const opacity = await pill.evaluate((element) =>
    Number(getComputedStyle(element).opacity),
  );
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  return {
    onItem:
      pillBox !== null &&
      itemBox !== null &&
      near(pillBox.x, itemBox.x) &&
      near(pillBox.y, itemBox.y) &&
      near(pillBox.width, itemBox.width) &&
      near(pillBox.height, itemBox.height),
    opacity,
  };
}

/** What a highlight at rest under its item reads. */
export const AT_REST: PillState = { onItem: true, opacity: 1 };
