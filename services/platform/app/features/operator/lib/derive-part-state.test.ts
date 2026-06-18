import { describe, expect, it } from 'vitest';

import type { ExecutionNodeState } from '@/convex/workflows/executions/get_execution_step_statuses';

import { derivePartState } from './derive-part-state';

const node = (over: Partial<ExecutionNodeState>): ExecutionNodeState => ({
  status: 'success',
  attempts: 1,
  ...over,
});

describe('derivePartState', () => {
  it('maps an absent node to loading (scheduled, not started)', () => {
    expect(derivePartState(undefined, 'read_only')).toBe('loading');
  });

  it('maps running through directly', () => {
    expect(derivePartState(node({ status: 'running' }), 'read_only')).toBe(
      'running',
    );
  });

  it('routes a waiting node by interaction: actionable → human', () => {
    expect(derivePartState(node({ status: 'waiting' }), 'actionable')).toBe(
      'waiting_human',
    );
  });

  it('routes a waiting node by interaction: read-only → external', () => {
    expect(derivePartState(node({ status: 'waiting' }), 'read_only')).toBe(
      'waiting_external',
    );
  });

  it('treats a debug-paused node as waiting_external', () => {
    expect(derivePartState(node({ status: 'paused' }), 'actionable')).toBe(
      'waiting_external',
    );
  });

  it('maps failed and canceled to output_error', () => {
    expect(derivePartState(node({ status: 'failed' }), 'read_only')).toBe(
      'output_error',
    );
    expect(derivePartState(node({ status: 'canceled' }), 'read_only')).toBe(
      'output_error',
    );
  });

  it('maps a successful node with output to output_available', () => {
    expect(
      derivePartState(
        node({ status: 'success', outputPreview: '{"a":1}' }),
        'read_only',
      ),
    ).toBe('output_available');
  });

  it('maps a successful node with no output to empty', () => {
    expect(derivePartState(node({ status: 'success' }), 'read_only')).toBe(
      'empty',
    );
  });

  it('treats output-unavailable (offloaded) success as output_available', () => {
    expect(
      derivePartState(
        node({ status: 'success', outputUnavailable: true }),
        'read_only',
      ),
    ).toBe('output_available');
  });
});
