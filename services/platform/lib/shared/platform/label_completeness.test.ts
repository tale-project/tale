import { describe, expect, it } from 'vitest';

import {
  collectViewLabelKeys,
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

describe('collectViewLabelKeys', () => {
  it('collects $label: markers from titles, tab labels, columnLabels, and args at any depth', () => {
    const view = {
      title: '$label:issueDesk.deskTitle',
      description: 'a plain literal description', // no marker → ignored
      tabs: [
        {
          id: 'issues',
          label: '$label:issueDesk.tab.issues',
          data: {
            content: [
              {
                type: 'ExternalList',
                props: {
                  title: '$label:issueDesk.issuesListTitle',
                  columnLabels: {
                    number: '$label:issueDesk.col.number',
                    title: '$label:issueDesk.col.title',
                  },
                  actions: [
                    { args: { description: '$label:issueDesk.taskTemplate' } },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    expect(collectViewLabelKeys(view)).toEqual([
      'issueDesk.deskTitle',
      'issueDesk.tab.issues',
      'issueDesk.issuesListTitle',
      'issueDesk.col.number',
      'issueDesk.col.title',
      'issueDesk.taskTemplate',
    ]);
  });

  it('returns nothing for a view with no $label: markers', () => {
    expect(collectViewLabelKeys({ title: 'Plain', tabs: [] })).toEqual([]);
    expect(collectViewLabelKeys(undefined)).toEqual([]);
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
