/**
 * A notification's stored `params`, made readable before they are
 * interpolated into its localized text — by the bell in the app and by the
 * REST mirror (`GET /api/v1/notifications/sync`), which render the same
 * `inbox` catalog.
 *
 * Most params are already words — a title, a person's name. A task's status
 * is stored as its id (`in_progress`, `in_review`), and printing the id gave
 * "moved from in_progress to in_review" in every language. `from` and `to`
 * are mapped through the board's own status labels, so the text names a
 * column the way the board does; a value that is not a status stays as it
 * was written. Every other value passes through untouched: the ICU formatter
 * falls back to the raw template for the WHOLE message when one value it
 * names is missing, so nothing is dropped here.
 *
 * Layer A: pure data.
 */
export function readableNotificationParams(
  params: Record<string, unknown> | null | undefined,
  taskStatusLabel: (status: string) => string | undefined,
): Record<string, unknown> | undefined {
  if (params == null) return undefined;
  const readable: Record<string, unknown> = { ...params };
  for (const name of ['from', 'to']) {
    const value = params[name];
    if (typeof value !== 'string') continue;
    const label = taskStatusLabel(value);
    if (label !== undefined) readable[name] = label;
  }
  return readable;
}
