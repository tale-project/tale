import { describe, it, expect } from 'vitest';
import { getShardIndex, NUM_SHARDS, safeShardIndex } from './shard';

describe('getShardIndex', () => {
  it('returns a value in [0, NUM_SHARDS)', () => {
    const ids = ['abc123', 'wfDef_xyz', '', 'a', 'very-long-id-'.repeat(100)];
    for (const id of ids) {
      const shard = getShardIndex(id);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(NUM_SHARDS);
      expect(Number.isInteger(shard)).toBe(true);
    }
  });

  it('is deterministic — same input always returns same shard', () => {
    const id = 'wfDef_test_deterministic';
    const first = getShardIndex(id);
    for (let i = 0; i < 100; i++) {
      expect(getShardIndex(id)).toBe(first);
    }
  });

  it('distributes across multiple shards for varied inputs', () => {
    const shards = new Set<number>();
    for (let i = 0; i < 100; i++) {
      shards.add(getShardIndex(`wfDef_${i}_${Math.random()}`));
    }
    expect(shards.size).toBeGreaterThan(1);
  });

  it('produces different shards for different definition IDs', () => {
    const testIds = [
      'document_rag_sync',
      'onedrive_sync',
      'customer_status_assessment',
      'product_recommendation',
      'product_recommendation_email',
      'conversation_auto_archive',
    ];
    const shards = new Set(testIds.map(getShardIndex));
    expect(shards.size).toBeGreaterThan(1);
  });

  it('handles special characters', () => {
    const ids = [
      '🚀',
      'id with spaces',
      'id\twith\ttabs',
      'id\nwith\nnewlines',
      '日本語テスト',
    ];
    for (const id of ids) {
      const shard = getShardIndex(id);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(NUM_SHARDS);
    }
  });
});

describe('NUM_SHARDS', () => {
  it('is 4', () => {
    expect(NUM_SHARDS).toBe(4);
  });
});

describe('safeShardIndex', () => {
  it('returns the value when in range', () => {
    expect(safeShardIndex(0)).toBe(0);
    expect(safeShardIndex(3)).toBe(3);
  });

  it('returns 0 for undefined', () => {
    expect(safeShardIndex(undefined)).toBe(0);
  });

  it('returns 0 for out-of-range values', () => {
    expect(safeShardIndex(-1)).toBe(0);
    expect(safeShardIndex(4)).toBe(0);
    expect(safeShardIndex(999)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(safeShardIndex(NaN)).toBe(0);
  });
});
