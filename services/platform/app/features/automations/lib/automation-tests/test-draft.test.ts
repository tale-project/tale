import { describe, expect, it } from 'vitest';

import {
  addTest,
  blankTest,
  duplicateTest,
  removeTest,
  replaceTest,
  testNameOf,
  testsOf,
  unusedTestName,
} from './test-draft';

const DOC = {
  name: 'billing/dunning',
  inputs: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      days: { type: 'integer' },
      dryRun: { type: 'boolean' },
    },
    required: ['owner', 'days'],
  },
  nodes: [],
  tests: [
    { name: 'smoke', input: { owner: 'acme', days: 3 }, note: 'kept' },
    { name: 'late', input: { owner: 'acme', days: 30 } },
  ],
};

describe('the draft’s tests', () => {
  it('reads the tests as written, and none without a list', () => {
    expect(testsOf(DOC)).toHaveLength(2);
    expect(testsOf({ name: 'x', nodes: [] })).toEqual([]);
    expect(testsOf({ tests: 'not a list' })).toEqual([]);
    expect(testsOf(null)).toEqual([]);
    expect(testNameOf({ name: '  ' })).toBeUndefined();
    expect(testNameOf('smoke')).toBeUndefined();
  });

  it('starts a blank test from what the run input requires', () => {
    expect(blankTest(DOC, 'New test')).toEqual({
      name: 'New test',
      input: { owner: '', days: 0 },
      expect: {},
    });
    expect(blankTest({ nodes: [] }, 'New test')).toEqual({
      name: 'New test',
      input: {},
      expect: {},
    });
  });

  it('names a new test so no two read alike', () => {
    expect(unusedTestName(DOC, 'New test')).toBe('New test');
    expect(unusedTestName(DOC, 'smoke')).toBe('smoke 2');
    const twice = addTest(DOC, { name: 'smoke 2', input: {} }).document;
    expect(unusedTestName(twice, 'smoke')).toBe('smoke 3');
  });

  it('adds at the end and says where', () => {
    const { document, index } = addTest(DOC, { name: 'new', input: {} });
    expect(index).toBe(2);
    expect(testsOf(document).map(testNameOf)).toEqual(['smoke', 'late', 'new']);
    // The document beside the tests is untouched.
    expect(document.inputs).toBe(DOC.inputs);
    expect(addTest({ nodes: [] }, { name: 'first', input: {} }).index).toBe(0);
  });

  it('replaces a test as given, keys this build does not know included', () => {
    const next = replaceTest(DOC, 0, {
      name: 'smoke',
      input: { owner: 'zeta', days: 1 },
      note: 'still kept',
    });
    expect(testsOf(next)[0]).toEqual({
      name: 'smoke',
      input: { owner: 'zeta', days: 1 },
      note: 'still kept',
    });
    expect(testsOf(next)[1]).toBe(DOC.tests[1]);
    expect(replaceTest(DOC, 5, {})).toBe(DOC);
  });

  it('removes a test, and the key with the last one', () => {
    expect(testsOf(removeTest(DOC, 0)).map(testNameOf)).toEqual(['late']);
    const none = removeTest(removeTest(DOC, 0), 0);
    expect('tests' in none).toBe(false);
    expect(removeTest(DOC, -1)).toBe(DOC);
  });

  it('copies a test right after itself, every key kept, under a new name', () => {
    const copied = duplicateTest(DOC, 0, 'smoke (copy)');
    expect(copied?.index).toBe(1);
    const tests = testsOf(copied?.document ?? null);
    expect(tests.map(testNameOf)).toEqual(['smoke', 'smoke (copy)', 'late']);
    expect(tests[1]).toEqual({
      name: 'smoke (copy)',
      input: { owner: 'acme', days: 3 },
      note: 'kept',
    });
    // A copy, not the same object: editing one leaves the other.
    expect(tests[1]).not.toBe(tests[0]);
    expect(duplicateTest(DOC, 9, 'x')).toBeNull();
  });
});
