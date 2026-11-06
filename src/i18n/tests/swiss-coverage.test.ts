import { describe, expect, it } from 'vitest';

import { missingSwissForms } from './swiss-coverage';

describe('Swiss fallback coverage guard', () => {
  const german = {
    actions: { close: 'Schließen', expand: 'Vergrößern', save: 'Speichern' },
  };

  it('rejects missing nested overrides while allowing ordinary German fallback', () => {
    expect(
      missingSwissForms(german, { actions: { close: 'Schliessen' } }),
    ).toEqual(['actions.expand']);
  });

  it('rejects an override that still contains ß', () => {
    expect(missingSwissForms(german, german)).toEqual([
      'actions.close',
      'actions.expand',
    ]);
  });

  it('accepts Swiss forms and real regional variants', () => {
    expect(
      missingSwissForms(german, {
        actions: { close: 'Schliessen', expand: 'Grösser anzeigen' },
      }),
    ).toEqual([]);
  });

  it('checks each string in array values', () => {
    expect(
      missingSwissForms(
        { steps: ['Schließen', 'Vergrößern'] },
        { steps: ['Schliessen'] },
      ),
    ).toEqual(['steps.1']);
    expect(
      missingSwissForms({ steps: ['Schließen'] }, { steps: ['Schliessen'] }),
    ).toEqual([]);
  });
});
