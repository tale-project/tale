import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SECRET_KINDS } from '@/lib/api/schemas';
import { i18n } from '@/lib/i18n/i18n';
import { meta, sessionRef } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { useSecretLabels } from './use-secret-labels';

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('useSecretLabels', () => {
  it('names the four kinds, as the server does in English', () => {
    const { result } = renderHookApp(useSecretLabels);
    expect(SECRET_KINDS.map((kind) => result.current.kind(kind))).toEqual(
      meta().secretKinds.map((kind) => kind.label),
    );
  });

  it('says in one line what each kind holds and gives a made-up title of it', () => {
    const { result } = renderHookApp(useSecretLabels);
    expect(result.current.kindHint('credentials')).toBe(
      'A website with its username and password.',
    );
    expect(result.current.titleExample('card')).toBe('e.g. Visa ending 4242');
    for (const kind of SECRET_KINDS) {
      expect(result.current.kindHint(kind)).not.toBe('');
      expect(result.current.titleExample(kind)).not.toBe('');
    }
  });

  it('has a word for every field a kind starts with', () => {
    const { result } = renderHookApp(useSecretLabels);
    for (const kind of meta().secretKinds) {
      for (const spec of kind.fields) {
        expect(result.current.field(spec.label)).not.toBe('');
      }
    }
  });

  it('shows a label no catalog knows as it was typed', () => {
    const { result } = renderHookApp(useSecretLabels);
    expect(result.current.field('Backup code')).toBe('Backup code');
    expect(result.current.field('Mein Passwort')).toBe('Mein Passwort');
    expect(result.current.field('')).toBe('');
  });

  it('knows a starting label whatever its case and the blanks around it', () => {
    const { result } = renderHookApp(useSecretLabels);
    expect(result.current.field('  CARD NUMBER ')).toBe('Card number');
    expect(result.current.field('password')).toBe('Password');
  });

  it('says who a secret is for and sums it up with its kind', () => {
    const { result } = renderHookApp(useSecretLabels);
    expect(
      result.current.summary({
        kind: 'note',
        session: sessionRef({ name: '0003' }),
      }),
    ).toBe('Note · Session "0003"');
    expect(
      result.current.summary({
        kind: 'card',
        session: sessionRef({ name: 'Shop' }),
      }),
    ).toBe('Credit card · Session "Shop"');
    expect(result.current.summary({ kind: 'note', session: null })).toBe(
      'Note · Every session',
    );
  });

  it('speaks German to a person who reads German, to the label', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { result } = renderHookApp(useSecretLabels);
    await waitFor(() =>
      expect(result.current.kind('personal')).toBe('Persönliche Angaben'),
    );
    expect(result.current.kind('credentials')).toBe('Zugangsdaten');
    expect(result.current.kind('card')).toBe('Kreditkarte');
    expect(result.current.kind('note')).toBe('Notiz');
    expect(result.current.field('Password')).toBe('Passwort');
    expect(result.current.field('username')).toBe('Benutzername');
    expect(result.current.field('Card number')).toBe('Kartennummer');
    expect(result.current.field('Backup code')).toBe('Backup code');
    expect(result.current.summary({ kind: 'note', session: null })).toBe(
      'Notiz · Jede Sitzung',
    );
    expect(
      result.current.summary({
        kind: 'note',
        session: sessionRef({ name: '0003' }),
      }),
    ).toBe('Notiz · Sitzung „0003“');
  });

  it('speaks French to a person who reads French, to the label', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    const { result } = renderHookApp(useSecretLabels);
    await waitFor(() =>
      expect(result.current.kind('personal')).toBe('Informations personnelles'),
    );
    expect(result.current.kind('credentials')).toBe('Identifiants');
    expect(result.current.kind('card')).toBe('Carte bancaire');
    expect(result.current.field('Password')).toBe('Mot de passe');
    expect(result.current.field('Company address')).toBe(
      "Adresse de l'entreprise",
    );
    expect(result.current.summary({ kind: 'note', session: null })).toBe(
      'Note · Toutes les sessions',
    );
  });
});
