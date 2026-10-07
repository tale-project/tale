import { describe, expect, it } from 'vitest';

import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';

const cases = [
  {
    locale: 'en',
    messages: enMessages,
    refused:
      "Your organization reserves sharing with everyone, and you aren't allowed to publish. Share the skill with your teams instead.",
    exists: 'A skill with this name already exists. Nothing was changed.',
  },
  {
    locale: 'de',
    messages: deMessages,
    refused:
      'Deine Organisation beschränkt das Teilen mit allen, und du darfst nicht veröffentlichen. Teile den Skill stattdessen mit deinen Teams.',
    exists:
      'Ein Skill mit diesem Namen existiert bereits. Es wurde nichts geändert.',
  },
  {
    locale: 'fr',
    messages: frMessages,
    refused:
      "Ton organisation réserve le partage avec tout le monde, et tu n'as pas le droit de publier. Partage plutôt ce skill avec tes équipes.",
    exists:
      'Un skill portant ce nom existe déjà. Aucune modification n’a été effectuée.',
  },
];

describe('parsed skill refusal messages', () => {
  for (const { locale, messages, refused, exists } of cases) {
    it(`${locale}: keeps the complete publishing refusal separate from the duplicate refusal`, () => {
      expect(messages.skills.publishing.refused).toBe(refused);
      expect(messages.skills.publishing.exists).toBe(exists);
    });
  }
});
