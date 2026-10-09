import { describe, expect, it } from 'vitest';

import { t as englishLabel } from '../e2e/helpers/i18n';
import { CAPTURE_LOCALES } from './capture-options';
import { t, withCaptureLocale } from './i18n';

const NATIVE_LABELS = [
  'chat.aria.chatInput',
  'chat.aria.messageHistory',
  'chat.picker.ariaLabel',
  'chat.send',
  'home.views.inbox',
  'conversations.messagePlaceholder',
  'projects.agents.rowEdit',
  'automations.runs.nodeStatus.ok',
  'tasks.fields.description',
  'tasks.fields.priority',
  'tasks.actions.create',
  'projects.agents.newAgent',
  'knowledgeEntries.searchPlaceholder',
  'settings.logs.heading',
  'automations.runs.heading',
] as const;

describe('native screenshot labels', () => {
  it('resolves every selected scene in each shipped screenshot locale', () => {
    for (const locale of CAPTURE_LOCALES) {
      withCaptureLocale(locale, () => {
        for (const key of NATIVE_LABELS)
          expect(t(key).length).toBeGreaterThan(0);
      });
    }
  });

  it('keeps locale through async scene preparation without changing seed labels', async () => {
    const labels = await Promise.all(
      CAPTURE_LOCALES.map((locale) =>
        withCaptureLocale(locale, async () => {
          await Promise.resolve();
          return t('chat.send');
        }),
      ),
    );
    expect(labels).toEqual([
      'Send message',
      'Nachricht senden',
      'Envoyer le message',
    ]);
    expect(t('chat.send')).toBe('Send message');
    expect(englishLabel('chat.send')).toBe('Send message');
  });
});
