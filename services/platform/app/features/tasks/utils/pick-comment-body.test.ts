import { describe, expect, it } from 'vitest';

import { pickCommentBody } from './pick-comment-body';

const snapshot = {
  en: '[automated] Verification complete',
  de: '[automated] Prüfung abgeschlossen',
  fr: '[automated] Vérification terminée',
};

describe('pickCommentBody', () => {
  it('returns canonical body when no snapshot', () => {
    expect(pickCommentBody('hello', undefined, 'de')).toBe('hello');
  });

  it('picks the exact UI locale', () => {
    expect(pickCommentBody(snapshot.en, snapshot, 'de')).toBe(snapshot.de);
    expect(pickCommentBody(snapshot.en, snapshot, 'fr')).toBe(snapshot.fr);
  });

  it('narrows regional locales (de-CH → de)', () => {
    expect(pickCommentBody(snapshot.en, snapshot, 'de-CH')).toBe(snapshot.de);
  });

  it('falls back to en then canonical body', () => {
    expect(pickCommentBody(snapshot.en, snapshot, 'ja')).toBe(snapshot.en);
    expect(pickCommentBody('canonical', { ...snapshot, en: '' }, 'ja')).toBe(
      'canonical',
    );
  });
});
