/**
 * The props of a button whose work is under way: busy, off, and still there.
 * `isLoading` would disable it natively, and a disabled button drops the
 * keyboard of the person who just pressed it on the page; this one stays in
 * the tab order and ignores presses until the work is done (as the library's
 * own retry button of a failed list does).
 */
export function busyButton(pending: boolean, onClick: () => void) {
  return {
    'aria-busy': pending || undefined,
    'aria-disabled': pending || undefined,
    onClick: pending ? undefined : onClick,
  };
}
