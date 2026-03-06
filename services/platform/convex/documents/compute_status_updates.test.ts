import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';

import { computeStatusUpdates } from './compute_status_updates';

const docId = (id: string) => id as Id<'documents'>;
const now = Date.now();
const ONE_HOUR = 60 * 60 * 1000;
const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000;

function makeDoc(
  id: string,
  status: 'queued' | 'running' | 'completed' | 'failed',
  creationTime = now - ONE_HOUR,
) {
  return {
    _id: docId(id),
    _creationTime: creationTime,
    ragInfo: { status },
  };
}

describe('computeStatusUpdates', () => {
  it('returns empty array when no updates needed', () => {
    const docs = [makeDoc('d1', 'completed')];
    const statuses = { d1: { status: 'completed' } };
    expect(computeStatusUpdates(docs, statuses, now)).toEqual([]);
  });

  it('marks completed when RAG completed and Convex queued', () => {
    const docs = [makeDoc('d1', 'queued')];
    const statuses = { d1: { status: 'completed' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([
      {
        documentId: docId('d1'),
        ragInfo: { status: 'completed', indexedAt: now },
      },
    ]);
  });

  it('marks completed when RAG completed and Convex running', () => {
    const docs = [makeDoc('d1', 'running')];
    const statuses = { d1: { status: 'completed' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toHaveLength(1);
    expect(updates[0].ragInfo.status).toBe('completed');
  });

  it('marks running when RAG processing and Convex queued', () => {
    const docs = [makeDoc('d1', 'queued')];
    const statuses = { d1: { status: 'processing' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([
      {
        documentId: docId('d1'),
        ragInfo: { status: 'running' },
      },
    ]);
  });

  it('marks failed when RAG failed and Convex queued', () => {
    const docs = [makeDoc('d1', 'queued')];
    const statuses = { d1: { status: 'failed', error: 'Parse error' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([
      {
        documentId: docId('d1'),
        ragInfo: { status: 'failed', error: 'Parse error' },
      },
    ]);
  });

  it('marks failed when RAG returns null for completed doc (deleted from RAG)', () => {
    const docs = [makeDoc('d1', 'completed')];
    const statuses = { d1: null };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([
      {
        documentId: docId('d1'),
        ragInfo: {
          status: 'failed',
          error: 'Document no longer exists in RAG service',
        },
      },
    ]);
  });

  it('skips queued/running docs when RAG returns null (defer to polling)', () => {
    const docs = [makeDoc('d1', 'queued'), makeDoc('d2', 'running')];
    const statuses = { d1: null, d2: null };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([]);
  });

  it('marks processing timeout when running > 24h and RAG still processing', () => {
    const docs = [makeDoc('d1', 'running', now - TWENTY_FIVE_HOURS)];
    const statuses = { d1: { status: 'processing' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([
      {
        documentId: docId('d1'),
        ragInfo: { status: 'failed', error: 'Processing timed out' },
      },
    ]);
  });

  it('does not timeout if running < 24h and RAG still processing', () => {
    const docs = [makeDoc('d1', 'running', now - ONE_HOUR)];
    const statuses = { d1: { status: 'processing' } };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toEqual([]);
  });

  it('handles mixed batch correctly', () => {
    const docs = [
      makeDoc('d1', 'queued'),
      makeDoc('d2', 'running'),
      makeDoc('d3', 'completed'),
      makeDoc('d4', 'queued'),
    ];
    const statuses = {
      d1: { status: 'completed' },
      d2: { status: 'failed', error: 'OOM' },
      d3: null,
      d4: null,
    };
    const updates = computeStatusUpdates(docs, statuses, now);
    expect(updates).toHaveLength(3);
    expect(updates[0]).toEqual({
      documentId: docId('d1'),
      ragInfo: { status: 'completed', indexedAt: now },
    });
    expect(updates[1]).toEqual({
      documentId: docId('d2'),
      ragInfo: { status: 'failed', error: 'OOM' },
    });
    expect(updates[2]).toEqual({
      documentId: docId('d3'),
      ragInfo: {
        status: 'failed',
        error: 'Document no longer exists in RAG service',
      },
    });
  });
});
