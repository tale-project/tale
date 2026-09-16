import { describe, expect, it } from 'vitest';

import {
  approveConfirmation,
  outcomeFileSpecs,
  parseTaskSubjectContract,
  taskSubjectContractSchema,
} from './task-contract';

describe('the shared stored task contract', () => {
  it('retains the existing tolerant read and nested unknown-key stripping', () => {
    expect(parseTaskSubjectContract(undefined)).toBeNull();
    expect(parseTaskSubjectContract({ workflow: '' })).toBeNull();
    expect(
      parseTaskSubjectContract({
        workflow: 'case-desk',
        ignored: true,
        input: { kind: 'folder', setupFolderName: 'Setup', ignored: true },
        create: { enabled: true, description: 'Retained legacy description' },
      }),
    ).toEqual({
      workflow: 'case-desk',
      input: { kind: 'folder', setupFolderName: 'Setup' },
      create: { enabled: true, description: 'Retained legacy description' },
    });
  });

  it('preserves outcome order and optionality for both stored representations', () => {
    const contract = taskSubjectContractSchema.parse({
      workflow: 'case-desk',
      outcome: {
        files: [
          'report.md',
          { name: 'notes.md', optional: true },
          { name: '*.xml' },
        ],
      },
    });
    expect(outcomeFileSpecs(contract.outcome)).toEqual([
      { name: 'report.md', optional: false },
      { name: 'notes.md', optional: true },
      { name: '*.xml', optional: false },
    ]);
    expect(outcomeFileSpecs(undefined)).toEqual([]);
    expect(
      taskSubjectContractSchema.safeParse({
        workflow: 'case-desk',
        outcome: { files: [{ name: 'report.md', unknown: true }] },
      }).success,
    ).toBe(false);
  });

  it('resolves a declared approve consequence through the locale chain', () => {
    const contract = taskSubjectContractSchema.parse({
      workflow: 'filing-desk',
      review: {
        requestChanges: true,
        approve: {
          confirm: 'Approving tells the client the return is filed.',
          i18n: {
            de: { confirm: 'Freigeben meldet dem Kunden die Einreichung.' },
            'de-CH': {
              confirm: 'Freigeben meldet dem Kunden die Einreichung.',
            },
          },
        },
      },
    });
    expect(approveConfirmation(contract, 'en')).toBe(
      'Approving tells the client the return is filed.',
    );
    // An undeclared locale falls back to the authored English, a region to
    // its base language.
    expect(approveConfirmation(contract, 'fr')).toBe(
      'Approving tells the client the return is filed.',
    );
    expect(approveConfirmation(contract, 'de-AT')).toBe(
      'Freigeben meldet dem Kunden die Einreichung.',
    );
    // Nothing declared: Approve stays a one-click close.
    expect(
      approveConfirmation(
        taskSubjectContractSchema.parse({
          workflow: 'plain-desk',
          review: { requestChanges: true },
        }),
        'en',
      ),
    ).toBeUndefined();
    for (const approve of [
      { confirm: '' },
      { confirm: 'x'.repeat(501) },
      { confirm: 'ok', i18n: { german: { confirm: 'nein' } } },
    ]) {
      expect(
        taskSubjectContractSchema.safeParse({
          workflow: 'filing-desk',
          review: { approve },
        }).success,
      ).toBe(false);
    }
  });
});
