function isVerticallyScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const { overflow, overflowY } = getComputedStyle(el);
  if (
    overflowY === 'auto' ||
    overflowY === 'scroll' ||
    overflowY === 'overlay'
  ) {
    return true;
  }
  // Shorthand `overflow: auto|scroll` — some runtimes (incl. jsdom) leave
  // `overflowY` as `visible` while the shorthand is set on the element.
  return overflow === 'auto' || overflow === 'scroll';
}

function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let node = start;
  while (node) {
    if (isVerticallyScrollable(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * When a horizontally-scrollable container cannot absorb vertical wheel delta,
 * scroll the nearest scrollable ancestor instead. Prevents the classic wheel
 * trap over `overflow-x-auto` regions inside page-level scrollers (e.g.
 * Settings → Skills and the agent Bound skills tab).
 */
export function chainVerticalWheelToScrollParent(
  container: HTMLElement,
  event: WheelEvent,
): void {
  const { deltaY } = event;
  if (deltaY === 0) return;

  if (container.scrollHeight > container.clientHeight) {
    const { scrollTop, clientHeight, scrollHeight } = container;
    const atTop = scrollTop <= 0;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
    if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
      return;
    }
  }

  const scrollParent = findScrollableAncestor(container.parentElement);
  if (!scrollParent) return;

  scrollParent.scrollTop += deltaY;
  event.preventDefault();
}
