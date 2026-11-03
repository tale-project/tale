import { describe, expect, it } from 'vitest';

import { MOCK_STATE_MAX_BYTES } from './limits';
import { RunMockState, readMockStateSnapshot } from './mock-state';

describe('the run’s own state in mock mode [AUTO-R81]', () => {
  it('starts empty: null state, no record', () => {
    const state = new RunMockState();
    expect(state.state('task')).toBeNull();
    expect(state.answered('task', 'k1')).toBeUndefined();
    expect(state.revision).toBe(0);
    expect(state.snapshot()).toEqual({});
  });

  it('keeps one value per connector, and hands out copies', () => {
    const state = new RunMockState();
    expect(state.write('task', { state: { tasks: [1] } })).toEqual({
      kept: true,
    });
    const seen = state.state('task') as { tasks: number[] };
    seen.tasks.push(2);
    expect(state.state('task')).toEqual({ tasks: [1] });
    expect(state.state('github')).toBeNull();
    expect(state.revision).toBe(1);
  });

  it('keeps the state when a write brings none, and clears it on null', () => {
    const state = new RunMockState();
    state.write('task', { state: { n: 1 } });
    state.write('task', { answer: { key: 'k1', output: { id: 'a' } } });
    expect(state.state('task')).toEqual({ n: 1 });
    state.write('task', { state: null });
    expect(state.state('task')).toBeNull();
    expect(state.answered('task', 'k1')).toEqual({ output: { id: 'a' } });
  });

  it('answers a recorded key with the first answer, as a copy', () => {
    const state = new RunMockState();
    state.write('task', { answer: { key: 'k1', output: { id: 'a' } } });
    const first = state.answered('task', 'k1') as { output: { id: string } };
    first.output.id = 'changed';
    expect(state.answered('task', 'k1')).toEqual({ output: { id: 'a' } });
    expect(state.answered('task', 'toString')).toBeUndefined();
    expect(state.answered('other', 'k1')).toBeUndefined();
  });

  it('keeps nothing when a connector’s part would outgrow the cap', () => {
    const state = new RunMockState();
    state.write('task', { state: { n: 1 } });
    const big = 'x'.repeat(MOCK_STATE_MAX_BYTES);
    const refused = state.write('task', {
      state: { big },
      answer: { key: 'k1', output: 1 },
    });
    expect(refused).toEqual({
      kept: false,
      bytes: expect.any(Number),
      limit: MOCK_STATE_MAX_BYTES,
    });
    expect(refused.kept === false && refused.bytes).toBeGreaterThan(
      MOCK_STATE_MAX_BYTES,
    );
    expect(state.state('task')).toEqual({ n: 1 });
    expect(state.answered('task', 'k1')).toBeUndefined();
    expect(state.revision).toBe(1);
  });

  it('counts the record against the cap with the state', () => {
    const state = new RunMockState();
    const half = 'x'.repeat(MOCK_STATE_MAX_BYTES / 2);
    expect(state.write('task', { state: half }).kept).toBe(true);
    const refused = state.write('task', {
      answer: { key: 'k1', output: half },
    });
    expect(refused.kept).toBe(false);
    // Another connector has a cap of its own.
    expect(state.write('github', { state: half }).kept).toBe(true);
  });

  it('goes back to a mark, dropping what was kept since', () => {
    const state = new RunMockState();
    state.write('task', { state: { n: 1 } });
    const mark = state.mark();
    state.write('task', { state: { n: 2 }, answer: { key: 'k1', output: 1 } });
    state.write('github', { state: 'x' });
    state.restore(mark);
    expect(state.snapshot()).toEqual({
      task: { state: { n: 1 }, answers: {} },
    });
    // Going back is a change too: a holder that committed the later writes
    // commits the earlier state again.
    expect(state.revision).toBe(4);
  });

  it('round-trips through a snapshot, sharing nothing with it', () => {
    const state = new RunMockState();
    state.write('task', {
      state: { tasks: ['a'] },
      answer: { key: 'k1', output: { id: 'a' } },
    });
    const snapshot = state.snapshot();
    expect(snapshot).toEqual({
      task: { state: { tasks: ['a'] }, answers: { k1: { id: 'a' } } },
    });
    const resumed = new RunMockState(snapshot);
    (snapshot.task!.state as { tasks: string[] }).tasks.push('b');
    expect(resumed.state('task')).toEqual({ tasks: ['a'] });
    expect(resumed.answered('task', 'k1')).toEqual({ output: { id: 'a' } });
    expect(resumed.revision).toBe(0);
  });

  it('reads a stored snapshot back, and refuses what is none', () => {
    const stored = { task: { state: null, answers: { k1: 1 } } };
    expect(readMockStateSnapshot(stored)).toEqual(stored);
    expect(readMockStateSnapshot({})).toEqual({});
    for (const bad of [
      null,
      [],
      'state',
      { task: [] },
      { task: { answers: {} } },
      { task: { state: 1 } },
      { task: { state: 1, answers: [] } },
    ]) {
      expect(readMockStateSnapshot(bad)).toBeUndefined();
    }
  });
});
