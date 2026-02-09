import { describe, it, expect } from 'vitest';

import { PORTS } from '../constants';
import { createLoopResult } from './utils/create_loop_result';
import { createLoopState } from './utils/create_loop_state';

describe('createLoopState', () => {
  it('should create initial state for first iteration', () => {
    const state = createLoopState(0, 5, false, 0);

    expect(state).toEqual({
      currentIndex: 0,
      totalItems: 5,
      isComplete: false,
      iterations: 0,
      batchesProcessed: 0,
    });
  });

  it('should create state for mid-loop iteration', () => {
    const state = createLoopState(2, 5, false, 2);

    expect(state).toEqual({
      currentIndex: 2,
      totalItems: 5,
      isComplete: false,
      iterations: 2,
      batchesProcessed: 2,
    });
  });

  it('should create completed state', () => {
    const state = createLoopState(5, 5, true, 5);

    expect(state).toEqual({
      currentIndex: 5,
      totalItems: 5,
      isComplete: true,
      iterations: 5,
      batchesProcessed: 5,
    });
  });
});

describe('createLoopResult', () => {
  it('should create loop result with correct port', () => {
    const state = createLoopState(0, 3, false, 0);
    const result = createLoopResult(
      PORTS.LOOP,
      ['a', 'b', 'c'],
      state,
      'a',
      0,
      undefined,
      'my_loop',
    );

    expect(result.port).toBe('loop');
    expect(result.output.type).toBe('loop');
  });

  it('should include loop variables with ownerStepSlug', () => {
    const state = createLoopState(0, 2, false, 0);
    const result = createLoopResult(
      PORTS.LOOP,
      [1, 2],
      state,
      1,
      0,
      undefined,
      'step_loop',
    );

    const loopVars = result.variables.loop as Record<string, unknown>;
    expect(loopVars.ownerStepSlug).toBe('step_loop');
    expect(loopVars.item).toBe(1);
    expect(loopVars.index).toBe(0);
    expect(loopVars.items).toEqual([1, 2]);
  });

  it('should include parent loop reference for nested loops', () => {
    const parentLoop = {
      ownerStepSlug: 'outer_loop',
      items: ['x', 'y'],
      state: createLoopState(0, 2, false, 0),
      item: 'x',
      index: 0,
    };

    const state = createLoopState(0, 3, false, 0);
    const result = createLoopResult(
      PORTS.LOOP,
      ['a', 'b', 'c'],
      state,
      'a',
      0,
      parentLoop,
      'inner_loop',
    );

    const loopVars = result.variables.loop as Record<string, unknown>;
    expect(loopVars.parent).toBe(parentLoop);
  });

  it('should use DONE port when loop completes', () => {
    const state = createLoopState(3, 3, true, 3);
    const result = createLoopResult(
      PORTS.DONE,
      ['a', 'b', 'c'],
      state,
      null,
      -1,
      undefined,
      'my_loop',
    );

    expect(result.port).toBe('done');
    const loopVars = result.variables.loop as Record<string, unknown>;
    expect(loopVars.item).toBeNull();
    expect(loopVars.index).toBe(-1);
  });

  it('should include state and current item in output data', () => {
    const state = createLoopState(1, 3, false, 1);
    const result = createLoopResult(
      PORTS.LOOP,
      ['a', 'b', 'c'],
      state,
      'b',
      1,
      undefined,
      'loop_step',
    );

    const data = result.output.data as Record<string, unknown>;
    expect(data.state).toEqual(state);
    expect(data.item).toBe('b');
  });
});

describe('PORTS constants', () => {
  it('should have correct values', () => {
    expect(PORTS.LOOP).toBe('loop');
    expect(PORTS.DONE).toBe('done');
    expect(PORTS.TRUE).toBe('true');
    expect(PORTS.FALSE).toBe('false');
    expect(PORTS.SUCCESS).toBe('success');
  });
});
