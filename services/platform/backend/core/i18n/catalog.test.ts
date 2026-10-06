import { describe, expect, it } from 'vitest';

import { catalogString, messageCatalog } from './catalog';

describe('catalogString', () => {
  it('reads a string in the locale the interface shows', () => {
    expect(catalogString('en', 'tasks.actions.create')).toBe('Create task');
    expect(catalogString('de', 'tasks.actions.create')).toBe(
      'Aufgabe erstellen',
    );
    expect(catalogString('fr', 'tasks.actions.create')).toBe('Créer une tâche');
  });

  it('reads a region through its language, and anything else in English', () => {
    expect(catalogString('de-DE', 'tasks.actions.create')).toBe(
      'Aufgabe erstellen',
    );
    // The Swiss overlay holds only what differs; the rest is German.
    expect(catalogString('de-CH', 'tasks.actions.create')).toBe(
      'Aufgabe erstellen',
    );
    expect(catalogString('it', 'tasks.actions.create')).toBe('Create task');
  });

  it('answers nothing for a path that names no string', () => {
    expect(catalogString('en', 'tasks.actions')).toBeUndefined();
    expect(catalogString('en', 'tasks.no-such-key')).toBeUndefined();
  });

  it('reads every topic file of a locale under its topic', () => {
    expect(messageCatalog('en')).toHaveProperty('tasks.actions.create');
    expect(messageCatalog('en')).toHaveProperty('inbox');
    // The Swiss overlay is sparse: only the topics it overrides.
    expect(Object.keys(messageCatalog('de-CH')).length).toBeLessThan(
      Object.keys(messageCatalog('de')).length,
    );
  });
});
