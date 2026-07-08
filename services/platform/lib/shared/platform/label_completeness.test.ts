import { describe, expect, it } from 'vitest';

import {
  collectWorkflowLabelKeys,
  findMissingLabelKeys,
} from './label_completeness';

describe('collectWorkflowLabelKeys', () => {
  it('collects ui.labelKey and ui.params.fields[].labelKey across steps', () => {
    const workflow = {
      steps: [
        { ui: { labelKey: 'desk.implement' } },
        {
          ui: {
            labelKey: 'desk.review',
            params: {
              fields: [
                { key: 'a', labelKey: 'desk.fieldA', type: 'string' },
                { key: 'b', labelKey: 'desk.fieldB', type: 'string' },
              ],
            },
          },
        },
        { stepType: 'noop' }, // no ui → contributes nothing
        'not-a-record',
      ],
    };
    expect(collectWorkflowLabelKeys(workflow)).toEqual([
      'desk.implement',
      'desk.review',
      'desk.fieldA',
      'desk.fieldB',
    ]);
  });

  it('tolerates a workflow with no steps', () => {
    expect(collectWorkflowLabelKeys({})).toEqual([]);
    expect(collectWorkflowLabelKeys({ steps: undefined })).toEqual([]);
  });
});

describe('findMissingLabelKeys', () => {
  const catalogs = {
    en: { 'desk.a': 'A', 'desk.b': 'B' },
    de: { 'desk.a': 'A-de', 'desk.b': '' }, // empty string counts as missing
    fr: { 'desk.a': 'A-fr' }, // desk.b absent entirely
  };

  it('is empty when every key is present in every locale', () => {
    expect(
      findMissingLabelKeys(['desk.a'], catalogs, ['en', 'de', 'fr']),
    ).toEqual([]);
  });

  it('reports keys missing or empty in any base locale', () => {
    expect(
      findMissingLabelKeys(['desk.b'], catalogs, ['en', 'de', 'fr']),
    ).toEqual([
      'label key "desk.b" missing in locale "de"',
      'label key "desk.b" missing in locale "fr"',
    ]);
  });

  it('dedupes referenced keys', () => {
    expect(
      findMissingLabelKeys(['desk.b', 'desk.b'], catalogs, ['fr']),
    ).toEqual(['label key "desk.b" missing in locale "fr"']);
  });
});
