import { describe, expect, it } from 'vitest';

import {
  getShardIndex,
  NUM_SHARDS,
} from '../../workflow_engine/helpers/engine/shard';
import {
  getWorkflowComponentForExecution,
  resolveExecutionShardIndex,
  WORKFLOW_COMPONENTS,
} from './get_workflow_component';

describe('resolveExecutionShardIndex', () => {
  it('prefers the persisted shardIndex when valid', () => {
    expect(resolveExecutionShardIndex({ _id: 'exec_1', shardIndex: 2 })).toBe(
      2,
    );
  });

  it('derives the shard from the execution id when shardIndex is missing', () => {
    const id = 'jd7f8gh2k3m4n5p6q7r8s9t0';
    expect(resolveExecutionShardIndex({ _id: id })).toBe(getShardIndex(id));
  });

  it('falls back to shard 0 for out-of-range persisted values', () => {
    expect(resolveExecutionShardIndex({ _id: 'exec_1', shardIndex: 7 })).toBe(
      0,
    );
    expect(resolveExecutionShardIndex({ _id: 'exec_1', shardIndex: -1 })).toBe(
      0,
    );
  });
});

describe('getWorkflowComponentForExecution', () => {
  it('exposes one component instance per shard', () => {
    expect(WORKFLOW_COMPONENTS).toHaveLength(NUM_SHARDS);
  });

  it('returns the component instance matching the execution shard', () => {
    for (let shard = 0; shard < NUM_SHARDS; shard++) {
      expect(
        getWorkflowComponentForExecution({ _id: 'exec_1', shardIndex: shard }),
      ).toBe(WORKFLOW_COMPONENTS[shard]);
    }
  });
});
