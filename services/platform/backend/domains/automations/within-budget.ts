/** `work()`'s answer, or `undefined` ("cannot tell") once the budget is
 * spent — the work itself is not cancelled, only no longer waited for. */
export function withinBudget<T>(
  budgetMs: number,
  work: () => Promise<T>,
  what = 'model availability',
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[automations] ${what} not answered within ${budgetMs} ms; cannot tell`,
      );
      resolve(undefined);
    }, budgetMs);
  });
  return Promise.race([work(), expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
