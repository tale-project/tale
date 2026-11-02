/** The toasts a reader can still see: the store keeps a dismissed one a moment. */
export function openToasts<T extends { open?: boolean }>(
  toasts: readonly T[],
): T[] {
  return toasts.filter((toast) => toast.open === true);
}
