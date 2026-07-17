import { describe, expect, test } from 'vitest';

import { toSpokenText } from './tts-text';

describe('toSpokenText', () => {
  test('respells the brand for German and French voices', () => {
    expect(toSpokenText('Das ist Tale — der Arbeitsbereich.', 'de')).toBe(
      'Das ist Tejl — der Arbeitsbereich.',
    );
    expect(toSpokenText('Voici Tale, ton espace.', 'fr')).toBe(
      'Voici Teïl, ton espace.',
    );
  });

  test('English narration is untouched', () => {
    expect(toSpokenText('This is Tale.', 'en')).toBe('This is Tale.');
  });

  test('replaces whole words only, everywhere they appear', () => {
    expect(toSpokenText('Tale zeigt, was Tale kann.', 'de')).toBe(
      'Tejl zeigt, was Tejl kann.',
    );
    // Substrings inside other words stay intact.
    expect(toSpokenText('Digitale Werkzeuge.', 'de')).toBe(
      'Digitale Werkzeuge.',
    );
  });
});
