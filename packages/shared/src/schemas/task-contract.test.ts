import { describe, expect, it } from 'vitest';

import {
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
});
