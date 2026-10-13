import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const cases = [
  {
    locale: 'en',
    messages: enMessages,
    refused:
      "Your organization reserves sharing with everyone, and you aren't allowed to publish. Share the skill with your teams instead.",
    exists: 'A skill with this name already exists. Nothing was changed.',
    stale:
      'This skill changed after you opened it, so nothing was saved. Your edits are still here. Copy what you need, then close this skill and open it again to see the latest version.',
  },
  {
    locale: 'de',
    messages: deMessages,
    refused:
      'Deine Organisation beschränkt das Teilen mit allen, und du darfst nicht veröffentlichen. Teile den Skill stattdessen mit deinen Teams.',
    exists:
      'Ein Skill mit diesem Namen existiert bereits. Es wurde nichts geändert.',
    stale:
      'Dieser Skill hat sich geändert, nachdem du ihn geöffnet hast, deshalb wurde nichts gespeichert. Deine Änderungen sind noch da. Kopiere, was du brauchst, schließe den Skill und öffne ihn erneut, um die neueste Version zu sehen.',
  },
  {
    locale: 'fr',
    messages: frMessages,
    refused:
      "Ton organisation réserve le partage avec tout le monde, et tu n'as pas le droit de publier. Partage plutôt ce skill avec tes équipes.",
    exists:
      'Un skill portant ce nom existe déjà. Aucune modification n’a été effectuée.',
    stale:
      'Ce skill a changé depuis que tu l’as ouvert, donc rien n’a été enregistré. Tes modifications sont toujours là. Copie ce dont tu as besoin, puis ferme le skill et rouvre-le pour voir la dernière version.',
  },
];

describe('parsed skill refusal messages', () => {
  for (const { locale, messages, refused, exists, stale } of cases) {
    it(`${locale}: keeps the complete publishing refusal separate from the duplicate refusal`, () => {
      expect(messages.skills.publishing.refused).toBe(refused);
      expect(messages.skills.publishing.exists).toBe(exists);
    });

    it(`${locale}: says a skill saved since it was opened refused the edit, and what is left`, () => {
      expect(messages.skills.editor.stale).toBe(stale);
    });
  }
});
