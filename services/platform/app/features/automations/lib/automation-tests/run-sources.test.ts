import { describe, expect, it } from 'vitest';

import {
  benchOfTest,
  rememberedSource,
  requiredInput,
  runInputSources,
  sourceMemoryOf,
} from './run-sources';

const WORDS = {
  unnamedTest: (number: number) => `Test ${number}`,
  empty: 'Empty',
  required: 'Fill the required fields',
};

const SCHEMA = {
  type: 'object',
  required: ['quantity', 'unitPrice'],
  properties: {
    quantity: { type: 'integer' },
    unitPrice: { type: 'number' },
    note: { type: 'string' },
  },
};

const sources = runInputSources({
  tests: [
    { name: 'small order', input: { quantity: 3, unitPrice: 20 } },
    {
      input: { quantity: 120, unitPrice: 20 },
      mocks: { rates: { chf: 1 } },
      failures: { notify: 'quota exceeded' },
    },
    { name: 'no input' },
  ],
  runs: [{ id: 'run-1', label: 'Succeeded · Oct 11, 5:02 PM' }],
  trigger: { label: "The trigger's input", input: { trigger: 'schedule' } },
  schema: SCHEMA,
  words: WORDS,
});

describe('where a test run’s input starts from', () => {
  it('lists the tests, the runs, the trigger, nothing and the required fields', () => {
    expect(sources.map((source) => [source.kind, source.label])).toEqual([
      ['test', 'small order'],
      ['test', 'Test 2'],
      ['test', 'no input'],
      ['run', 'Succeeded · Oct 11, 5:02 PM'],
      ['trigger', "The trigger's input"],
      ['empty', 'Empty'],
      ['required', 'Fill the required fields'],
    ]);
    // A test starts from its input, with what it stands in for; one without
    // an input runs with an empty one.
    expect(sources[1]).toMatchObject({
      input: { quantity: 120, unitPrice: 20 },
      bench: {
        mocks: { rates: { chf: 1 } },
        failures: { notify: 'quota exceeded' },
      },
    });
    expect(sources[0]).not.toHaveProperty('bench');
    expect(sources[2]).toMatchObject({ input: {} });
    expect(sources[3]).toMatchObject({ runId: 'run-1' });
    expect(sources.at(-1)).toMatchObject({
      input: { quantity: 0, unitPrice: 0 },
    });
  });

  it('offers no required fields when the input requires none', () => {
    const plain = runInputSources({
      tests: [],
      runs: [],
      trigger: null,
      schema: undefined,
      words: WORDS,
    });
    expect(plain.map((source) => source.kind)).toEqual(['empty']);
    expect(requiredInput({ type: 'object' })).toEqual({});
  });

  it('keeps only stand-ins a test actually has', () => {
    expect(benchOfTest({ name: 'x', input: {} })).toBeUndefined();
    expect(benchOfTest({ mocks: { rates: { chf: 1 } } })).toEqual({
      mocks: { rates: { chf: 1 } },
    });
    // A scenario pick travels with the rest, by its name; one that is not
    // a name is left to the test's own checks.
    expect(
      benchOfTest({
        failures: { notify: 'quota exceeded' },
        scenarios: { post: 'channel_not_found', fetch: 3 },
      }),
    ).toEqual({
      failures: { notify: 'quota exceeded' },
      scenarios: { post: 'channel_not_found' },
    });
    expect(benchOfTest({ scenarios: { post: 'channel_not_found' } })).toEqual({
      scenarios: { post: 'channel_not_found' },
    });
    expect(benchOfTest({ scenarios: { post: 3 } })).toBeUndefined();
  });

  it('remembers a test by its name, a run as the newest, and the rest by kind', () => {
    expect(sources.map(sourceMemoryOf)).toEqual([
      'test:small order',
      'test:Test 2',
      'test:no input',
      'run',
      'trigger',
      'empty',
      'required',
    ]);
    expect(rememberedSource(sources, 'test:small order')?.id).toBe('test:0');
    expect(rememberedSource(sources, 'run')?.id).toBe('run:run-1');
    expect(rememberedSource(sources, 'test:gone')).toBeUndefined();
    expect(rememberedSource(sources, null)).toBeUndefined();
  });
});
