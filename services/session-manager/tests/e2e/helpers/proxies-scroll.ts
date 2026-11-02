import { expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from './env';

/** How far one turn of the wheel scrolls a table, in pixels: under a screenful. */
const WHEEL_STEP = 250;

/**
 * Scrolls a table down with the wheel, a little at a time as a person does,
 * noting every row as it comes into view, until `count` different ones have.
 * `drawn` lists the rows the table has drawn now: a long table draws only the
 * ones near the part in view. Answers the rows in the order they came, and the
 * ones that were drawn twice at once.
 *
 * `first` is the row the list starts with. A search or a filter that was just
 * made leaves the rows of the list before on the table for a moment, and they
 * would be counted as rows of this one; the scan starts when the table starts
 * with `first`. It then runs for as long as rows keep coming into view: on a
 * busy machine it takes longer, and only a table that stops giving rows is the
 * failure.
 */
export async function scrollThrough(
  page: Page,
  table: Locator,
  drawn: () => Promise<string[]>,
  count: number,
  first: string,
): Promise<{ seen: string[]; drawnTwice: string[] }> {
  const seen: string[] = [];
  const known = new Set<string>();
  const drawnTwice: string[] = [];
  await expect
    .poll(async () => (await drawn())[0], {
      timeout: TIMEOUT.VISIBLE,
      message: `the table starts with ${first}`,
    })
    .toBe(first);
  // The wheel scrolls what is under the pointer.
  await table.hover();
  let lastRowAt = Date.now();
  while (known.size < count) {
    if (Date.now() - lastRowAt > TIMEOUT.BACKGROUND) {
      throw new Error(`Only ${known.size} of ${count} rows came into view`);
    }
    const rows = await drawn();
    for (const [index, row] of rows.entries()) {
      if (rows.indexOf(row) !== index) drawnTwice.push(row);
      if (!known.has(row)) {
        known.add(row);
        seen.push(row);
        lastRowAt = Date.now();
      }
    }
    await page.mouse.wheel(0, WHEEL_STEP);
  }
  return { seen, drawnTwice };
}
