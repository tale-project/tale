import { describe, expect, it } from 'vitest';

import {
  formOwnsPlace,
  readTestForm,
  scenarioAnswersOf,
  withDescription,
  withEffect,
  withFailure,
  withInput,
  withMock,
  withMustFail,
  withName,
  withNodeState,
  withOutput,
  withScenario,
  withScenarioAnswers,
} from './test-form';

const TEST = {
  name: 'big order',
  input: { quantity: 120 },
  note: 'a key this build does not know',
  mocks: { rates: { chf: 1 } },
  expect: {
    outputIncludes: { total: 2160 },
    nodes: { discount: 'ran', audit: 'not-a-state' },
    effects: [
      {
        connector: 'gmail.send_email',
        node: 'notify',
        inputIncludes: { to: 'a' },
      },
      { connector: 'slack.post', absent: true, channelHint: 'kept' },
    ],
  },
};

describe('a test read for the form', () => {
  it('reads every field the form shows, skipping what it cannot', () => {
    const values = readTestForm(TEST);
    expect(values).toMatchObject({
      name: 'big order',
      description: '',
      input: { quantity: 120 },
      mocks: [['rates', { chf: 1 }]],
      failures: [],
      scenarios: [],
      output: { mode: 'includes', value: { total: 2160 } },
      nodes: [['discount', 'ran']],
      failure: null,
    });
    expect(values.effects).toEqual([
      {
        connector: 'gmail.send_email',
        node: 'notify',
        absent: false,
        inputMode: 'includes',
        input: { to: 'a' },
      },
      { connector: 'slack.post', absent: true, inputMode: 'none' },
    ]);
    expect(readTestForm(null).output).toEqual({
      mode: 'none',
      value: undefined,
    });
  });

  it('reads every scenario pick, also one that is no name', () => {
    // A pick that is no text keeps its row, where its problem shows.
    expect(
      readTestForm({
        ...TEST,
        scenarios: { post: 'channel_not_found', fetch: 3 },
      }).scenarios,
    ).toEqual([
      ['post', 'channel_not_found'],
      ['fetch', 3],
    ]);
  });

  it('reads a list of scenarios as the answers the calls take in order', () => {
    expect(
      readTestForm({ ...TEST, scenarios: { post: ['rate_limited', 'posted'] } })
        .scenarios,
    ).toEqual([['post', ['rate_limited', 'posted']]]);
    expect(scenarioAnswersOf(['rate_limited', 'posted'])).toEqual([
      'rate_limited',
      'posted',
    ]);
    expect(scenarioAnswersOf('posted')).toEqual(['posted']);
    // A pick that is no list of names keeps one row, where its problem
    // shows: an empty list as well.
    expect(scenarioAnswersOf([])).toEqual([[]]);
    expect(scenarioAnswersOf(3)).toEqual([3]);
  });
});

describe('a test written by the form', () => {
  it('keeps every key the form does not show', () => {
    const next = withDescription(TEST, 'Orders over 100 get 10 % off');
    expect(next).toMatchObject({
      note: 'a key this build does not know',
      description: 'Orders over 100 get 10 % off',
    });
    expect('description' in withDescription(next, '  ')).toBe(false);
    expect(withInput(TEST, undefined).input).toEqual({});
  });

  it('adds and removes a simulated output or failure, and the key with the last', () => {
    const none = withMock(TEST, 'rates', undefined);
    expect('mocks' in none).toBe(false);
    const failing = withFailure(TEST, 'notify', 'quota exceeded');
    expect(failing.failures).toEqual({ notify: 'quota exceeded' });
    expect('failures' in withFailure(failing, 'notify', undefined)).toBe(false);
  });

  it('moves the output between equal and includes without losing it', () => {
    const equals = withOutput(TEST, 'equals', { total: 2160 });
    expect(equals.expect).toMatchObject({ output: { total: 2160 } });
    expect(equals.expect).not.toHaveProperty('outputIncludes');
    const none = withOutput(TEST, 'none', { total: 2160 });
    expect(none.expect).not.toHaveProperty('output');
    expect(none.expect).not.toHaveProperty('outputIncludes');
    // A value not written yet compares with null until it is.
    expect(
      withOutput({ name: 'x', input: {} }, 'equals', undefined).expect,
    ).toEqual({
      output: null,
    });
  });

  it('sets and clears a node state, keeping a state it cannot read', () => {
    const next = withNodeState(TEST, 'discount', 'skipped');
    expect(next.expect).toMatchObject({
      nodes: { discount: 'skipped', audit: 'not-a-state' },
    });
  });

  it('writes an action, keeping keys of it this build does not know', () => {
    const next = withEffect(TEST, 1, {
      connector: 'slack.post',
      absent: false,
      inputMode: 'equals',
      input: { text: 'hi' },
    });
    expect((next.expect as { effects: unknown[] }).effects[1]).toEqual({
      channelHint: 'kept',
      connector: 'slack.post',
      input: { text: 'hi' },
    });
    const appended = withEffect(TEST, 2, {
      connector: 'llm',
      absent: true,
      inputMode: 'none',
    });
    expect((appended.expect as { effects: unknown[] }).effects).toHaveLength(3);
    const removed = withEffect(withEffect(TEST, 0, undefined), 0, undefined);
    expect(removed.expect).not.toHaveProperty('effects');
  });

  it('picks, changes and removes a scenario, and the key with the last', () => {
    const picked = withScenario(TEST, 'post', 'posted');
    expect(picked.scenarios).toEqual({ post: 'posted' });
    const changed = withScenario(picked, 'post', 'channel_not_found');
    expect(changed.scenarios).toEqual({ post: 'channel_not_found' });
    // The other stand-ins and the keys the form does not show stay.
    expect(changed).toMatchObject({
      mocks: { rates: { chf: 1 } },
      note: 'a key this build does not know',
    });
    expect('scenarios' in withScenario(changed, 'post', undefined)).toBe(false);
  });

  it('writes the answers for the calls as a list, one as a name, none as no pick', () => {
    const listed = withScenarioAnswers(TEST, 'post', [
      'rate_limited',
      'posted',
    ]);
    expect(listed.scenarios).toEqual({ post: ['rate_limited', 'posted'] });
    expect(listed).toMatchObject({ note: 'a key this build does not know' });
    expect(withScenarioAnswers(listed, 'post', ['posted']).scenarios).toEqual({
      post: 'posted',
    });
    expect('scenarios' in withScenarioAnswers(listed, 'post', [])).toBe(false);
  });

  it('keeps the scenarios a test picks through every other edit', () => {
    const picked = { ...TEST, scenarios: { post: 'channel_not_found' } };
    const edits = [
      withName(picked, 'renamed'),
      withDescription(picked, 'Orders over 100 get 10 % off'),
      withInput(picked, { quantity: 1 }),
      withMock(picked, 'rates', undefined),
      withFailure(picked, 'notify', 'quota exceeded'),
      withOutput(picked, 'equals', { total: 2160 }),
      withNodeState(picked, 'discount', 'skipped'),
      withEffect(picked, 0, undefined),
      withMustFail(picked, { node: 'notify' }),
    ];
    for (const next of edits) {
      expect(next.scenarios).toEqual({ post: 'channel_not_found' });
    }
  });

  it('turns a run that must fail on and off, dropping the output it cannot have', () => {
    const failing = withMustFail(TEST, { node: 'notify', message: '' });
    expect(failing.expect).toMatchObject({ failure: { node: 'notify' } });
    expect(failing.expect).not.toHaveProperty('outputIncludes');
    expect(withMustFail(failing, null).expect).not.toHaveProperty('failure');
  });
});

describe('which places the form has a control for', () => {
  it.each([
    ['/tests/0/name', true],
    ['/tests/0/input/quantity', true],
    ['/tests/0/mocks/rates', true],
    ['/tests/0/mocks', false],
    ['/tests/0/failures/notify', true],
    ['/tests/0/scenarios/post', true],
    ['/tests/0/scenarios/post/1', true],
    ['/tests/0/scenarios', false],
    ['/tests/0/expect/output/total', true],
    ['/tests/0/expect/outputIncludes', true],
    ['/tests/0/expect/nodes/discount', true],
    ['/tests/0/expect/effects/1/connector', true],
    ['/tests/0/expect/failure', true],
    ['/tests/0/expct', false],
    ['/tests/0', false],
    ['/tests/1/name', false],
  ])('%s → %s', (pointer, owned) => {
    expect(formOwnsPlace(pointer, 0)).toBe(owned);
  });
});
