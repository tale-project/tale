import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_ACTIVE_COLUMN_SIZE,
  WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE,
  WEBHOOK_URL_COLUMN_SIZE,
  WEBHOOK_URL_TEXT_MAX_WIDTH,
} from './webhook-table-columns';

// Regression for #2568: the agent and workflow webhook tables used to
// hardcode the same three column sizes independently, which could silently
// drift. Both `agent-webhook-section.tsx` and `webhooks-section.tsx` import
// these constants for their `url` / `active` / `lastTriggered` columns, so
// sharing the source of truth (not just the numbers) is what this test
// locks in.
describe('webhook table column sizes', () => {
  it('sizes the active column to fit the Switch control, not wider', () => {
    // Switch track is 32px (`SWITCH_TRACK_DIMENSIONS`) plus ~24px of cell
    // padding — comfortably under the old 80px, well short of the url budget.
    expect(WEBHOOK_ACTIVE_COLUMN_SIZE).toBeGreaterThanOrEqual(64);
    expect(WEBHOOK_ACTIVE_COLUMN_SIZE).toBeLessThanOrEqual(70);
  });

  it('sizes the last-triggered column to fit a formatted timestamp', () => {
    expect(WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE).toBeGreaterThanOrEqual(140);
    expect(WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE).toBeLessThanOrEqual(150);
    // `DataTable` treats a declared size of exactly 150 as TanStack's "unset"
    // sentinel in some branches (`utilityPx` / `cellWidthStyle`) — picking
    // exactly 150 here would silently opt this column into auto-flex sizing.
    expect(WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE).not.toBe(150);
  });

  it('reclaims the space saved from active + lastTriggered into the url column', () => {
    const OLD_ACTIVE_SIZE = 80;
    const OLD_LAST_TRIGGERED_SIZE = 180;
    const OLD_URL_SIZE = 400;
    const reclaimed =
      OLD_ACTIVE_SIZE -
      WEBHOOK_ACTIVE_COLUMN_SIZE +
      (OLD_LAST_TRIGGERED_SIZE - WEBHOOK_LAST_TRIGGERED_COLUMN_SIZE);
    expect(WEBHOOK_URL_COLUMN_SIZE).toBe(OLD_URL_SIZE + reclaimed);

    // The visible URL text must grow by the same reclaimed amount — otherwise
    // the wider column is just empty margin, not a more readable URL.
    const OLD_URL_TEXT_MAX_WIDTH = 300;
    expect(WEBHOOK_URL_TEXT_MAX_WIDTH).toBe(OLD_URL_TEXT_MAX_WIDTH + reclaimed);
  });
});
