import { describe, expect, it } from 'vitest';

import {
  buildDebugWaitingFor,
  debugEventName,
  parseDebugWaitingFor,
} from './debug_gate';

describe('debugEventName / buildDebugWaitingFor', () => {
  it('builds the per-pause event name', () => {
    expect(debugEventName(1)).toBe('debug:1');
    expect(debugEventName(42)).toBe('debug:42');
  });

  it('builds the waitingFor marker with the step slug', () => {
    expect(buildDebugWaitingFor(3, 'send-email')).toBe('debug:3:send-email');
  });
});

describe('parseDebugWaitingFor', () => {
  it('round-trips a built waitingFor marker', () => {
    expect(parseDebugWaitingFor(buildDebugWaitingFor(7, 'fetch-data'))).toEqual(
      {
        pauseIndex: 7,
        stepSlug: 'fetch-data',
      },
    );
  });

  it('keeps colons inside the step slug intact', () => {
    expect(parseDebugWaitingFor('debug:2:loop:body:step')).toEqual({
      pauseIndex: 2,
      stepSlug: 'loop:body:step',
    });
  });

  it('returns null for empty or missing values', () => {
    expect(parseDebugWaitingFor(undefined)).toBeNull();
    expect(parseDebugWaitingFor('')).toBeNull();
  });

  it('returns null for non-debug waitingFor values (approval ids)', () => {
    expect(parseDebugWaitingFor('jd7f8gh2k3m4n5p6q7r8s9t0')).toBeNull();
  });

  it('returns null for malformed debug markers', () => {
    expect(parseDebugWaitingFor('debug:')).toBeNull();
    expect(parseDebugWaitingFor('debug:1')).toBeNull();
    expect(parseDebugWaitingFor('debug:abc:slug')).toBeNull();
    expect(parseDebugWaitingFor('debug:0:slug')).toBeNull();
    expect(parseDebugWaitingFor('debug:1:')).toBeNull();
  });
});
