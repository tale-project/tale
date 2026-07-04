import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

// Regression for #2356: the human-takeover card (human-control-card.tsx) and
// the canvas viewer error (workspace/file-viewer-router.tsx) rendered
// `defaultValue` fallbacks because these `chat` keys existed in no catalog, so
// de/fr silently rendered English. Assert every key the two components read is
// present in en/de/fr AND is genuinely translated (de/fr differ from en) — not
// falling back to the key or the English source.

// The keys human-control-card.tsx resolves via `useT('chat')`, plus the canvas
// viewer error key from file-viewer-router.tsx.
const CHAT_KEYS = [
  'humanControl.cardTitle',
  'humanControl.takeControl',
  'humanControl.takeControlHint',
  'humanControl.controllingHint',
  'humanControl.returnControl',
  'humanControl.errorAlreadyResolved',
  'humanControl.errorTurnRunning',
  'humanControl.errorReturnFailed',
  'humanControl.statusReturned',
  'humanControl.statusSuperseded',
  'humanControl.statusTimedOut',
  'canvas.error',
] as const;

describe('chat human-control + canvas i18n keys', () => {
  const tEn = i18n.getFixedT('en', 'chat');

  for (const key of CHAT_KEYS) {
    it(`${key} is present and localized in every locale`, () => {
      const en = tEn(key);
      // Present (not the raw key echoed back) and non-empty in the source.
      expect(en, `${key} missing from en catalog`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);

      for (const locale of ['de', 'fr'] as const) {
        const value = i18n.getFixedT(locale, 'chat')(key);
        expect(value, `${key} missing from ${locale} catalog`).not.toBe(key);
        expect(value.length).toBeGreaterThan(0);
        // The whole point of #2356: de/fr must not render the English string.
        expect(value, `${key} is not translated in ${locale}`).not.toBe(en);
      }
    });
  }
});
