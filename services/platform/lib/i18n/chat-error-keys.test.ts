/**
 * Regression guard for the chat-error label contract.
 *
 * `CHAT_ERROR_CODES` is the single source of truth for how a failed chat turn
 * is classified, and TWO catalog surfaces have to keep up with it:
 *
 *   1. The chat bubble renders the hint `CHAT_ERROR_I18N_KEY[code]` (plus the
 *      richer `CHAT_ERROR_I18N_KEY_NAMED[code]` when the model is known) from
 *      the `chat` namespace.
 *   2. The chat-health metrics page labels every bucket it gets back from
 *      `getOrgChatHealth` — which classifies through the same codes — with
 *      `analytics.chatHealth.errorType.<code>`.
 *
 * Surface 2 is built from a template literal, so the i18n usage scanner only
 * sees the constant prefix and cannot tell a missing code from a covered one:
 * `budget_exceeded` and `thread_busy` were added to the code list and shipped
 * for months with no label, printing the raw key in the Errors breakdown.
 * These tests close that gap by walking the code list itself.
 */

import { describe, expect, it } from 'vitest';

import {
  CHAT_ERROR_CODES,
  CHAT_ERROR_I18N_KEY,
  CHAT_ERROR_I18N_KEY_NAMED,
} from '@/lib/shared/chat-errors';
import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';

const LOCALES = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
};

describe('analytics.chatHealth.errorType — one label per classified code', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    const labels: Record<string, string> =
      bundle.analytics?.chatHealth?.errorType ?? {};

    for (const code of CHAT_ERROR_CODES) {
      it(`${locale}: ${code} has a breakdown label`, () => {
        expect(
          labels[code],
          `missing analytics.chatHealth.errorType.${code} in ${locale}`,
        ).toBeTruthy();
      });
    }

    // The other direction: a label for a retired code is dead weight that
    // hides the fact the code is gone.
    it(`${locale}: no label outlives its code`, () => {
      expect(Object.keys(labels).sort()).toEqual([...CHAT_ERROR_CODES].sort());
    });
  }
});

describe('chat error hints — one message per classified code', () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    const chat: Record<string, string> = bundle.chat ?? {};

    for (const code of CHAT_ERROR_CODES) {
      it(`${locale}: ${code} has a hint message`, () => {
        const key = CHAT_ERROR_I18N_KEY[code];
        expect(chat[key], `missing chat.${key} in ${locale}`).toBeTruthy();
      });
    }

    for (const [code, key] of Object.entries(CHAT_ERROR_I18N_KEY_NAMED)) {
      it(`${locale}: ${code} has a named hint message`, () => {
        expect(chat[key], `missing chat.${key} in ${locale}`).toBeTruthy();
      });
    }
  }
});
