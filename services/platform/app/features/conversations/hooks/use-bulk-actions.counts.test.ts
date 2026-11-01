import { describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

/**
 * The summary of a bulk action (`use-bulk-actions.ts`) counts what it did
 * and what failed, and the words around each count agree with it: "Resolved
 * 1 conversation, 1 failed", never "1 conversations" or the French
 * "1 échouées". Each row gives the text for 1 done and none failed, 1 done
 * and 1 failed, then 2 done and 2 failed.
 */
const SUMMARIES: ReadonlyArray<
  readonly [string, string, string, string, string]
> = [
  [
    'en',
    'messagesSentDescription',
    'Sent 1 message',
    'Sent 1 message, 1 failed',
    'Sent 2 messages, 2 failed',
  ],
  [
    'en',
    'resolvedDescription',
    'Resolved 1 conversation',
    'Resolved 1 conversation, 1 failed',
    'Resolved 2 conversations, 2 failed',
  ],
  [
    'en',
    'reopenedDescription',
    'Reopened 1 conversation',
    'Reopened 1 conversation, 1 failed',
    'Reopened 2 conversations, 2 failed',
  ],
  [
    'en',
    'archivedDescription',
    'Archived 1 conversation',
    'Archived 1 conversation, 1 failed',
    'Archived 2 conversations, 2 failed',
  ],
  [
    'en',
    'unarchivedDescription',
    'Unarchived 1 conversation',
    'Unarchived 1 conversation, 1 failed',
    'Unarchived 2 conversations, 2 failed',
  ],
  [
    'en',
    'markedAsSpamDescription',
    'Marked 1 conversation as spam',
    'Marked 1 conversation as spam, 1 failed',
    'Marked 2 conversations as spam, 2 failed',
  ],
  [
    'de',
    'messagesSentDescription',
    '1 Nachricht gesendet',
    '1 Nachricht gesendet, 1 fehlgeschlagen',
    '2 Nachrichten gesendet, 2 fehlgeschlagen',
  ],
  [
    'de',
    'resolvedDescription',
    '1 Konversation abgeschlossen',
    '1 Konversation abgeschlossen, 1 fehlgeschlagen',
    '2 Konversationen abgeschlossen, 2 fehlgeschlagen',
  ],
  [
    'de',
    'reopenedDescription',
    '1 Konversation erneut geöffnet',
    '1 Konversation erneut geöffnet, 1 fehlgeschlagen',
    '2 Konversationen erneut geöffnet, 2 fehlgeschlagen',
  ],
  [
    'de',
    'archivedDescription',
    '1 Konversation archiviert',
    '1 Konversation archiviert, 1 fehlgeschlagen',
    '2 Konversationen archiviert, 2 fehlgeschlagen',
  ],
  [
    'de',
    'unarchivedDescription',
    '1 Konversation dearchiviert',
    '1 Konversation dearchiviert, 1 fehlgeschlagen',
    '2 Konversationen dearchiviert, 2 fehlgeschlagen',
  ],
  [
    'de',
    'markedAsSpamDescription',
    '1 Konversation als Spam markiert',
    '1 Konversation als Spam markiert, 1 fehlgeschlagen',
    '2 Konversationen als Spam markiert, 2 fehlgeschlagen',
  ],
  [
    'fr',
    'messagesSentDescription',
    '1 message envoyé',
    '1 message envoyé, 1 échoué',
    '2 messages envoyés, 2 échoués',
  ],
  [
    'fr',
    'resolvedDescription',
    '1 conversation résolue avec succès',
    '1 conversation résolue avec succès, 1 échouée',
    '2 conversations résolues avec succès, 2 échouées',
  ],
  [
    'fr',
    'reopenedDescription',
    '1 conversation rouverte avec succès',
    '1 conversation rouverte avec succès, 1 échouée',
    '2 conversations rouvertes avec succès, 2 échouées',
  ],
  [
    'fr',
    'archivedDescription',
    '1 conversation archivée avec succès',
    '1 conversation archivée avec succès, 1 échouée',
    '2 conversations archivées avec succès, 2 échouées',
  ],
  [
    'fr',
    'unarchivedDescription',
    '1 conversation désarchivée avec succès',
    '1 conversation désarchivée avec succès, 1 échouée',
    '2 conversations désarchivées avec succès, 2 échouées',
  ],
  [
    'fr',
    'markedAsSpamDescription',
    '1 conversation marquée comme spam avec succès',
    '1 conversation marquée comme spam avec succès, 1 échouée',
    '2 conversations marquées comme spam avec succès, 2 échouées',
  ],
];

const COUNTS = [
  { successCount: 1, failedCount: 0 },
  { successCount: 1, failedCount: 1 },
  { successCount: 2, failedCount: 2 },
];

describe('the summary of a bulk action', () => {
  it.each(SUMMARIES)(
    'in %s, bulk.%s agrees with each count',
    (locale, key, ...texts) => {
      const t = i18n.getFixedT(locale, 'conversations');
      expect(COUNTS.map((counts) => t(`bulk.${key}`, counts))).toEqual(texts);
    },
  );
});
