/**
 * Where a staged document stands for the assistant — one decision for the
 * chip, the toasts and the send gate's words. A read still to come is
 * "Reading…"; once the read is decided, the read speaks, whatever the index
 * does. A read whose job was lost does not spin for good: when the file's
 * index already ended, the index's state speaks until the read watchdog
 * settles the read.
 */

import { describe, expect, it } from 'vitest';

import { documentReadingState } from './document-chip-status';

describe('documentReadingState', () => {
  it('reads a pending read as reading while its index is still to come', () => {
    for (const textStatus of ['queued', 'running'] as const) {
      for (const status of ['queued', 'running', undefined] as const) {
        expect(documentReadingState({ textStatus, status })).toEqual({
          kind: 'reading',
        });
      }
    }
  });

  it('lets an index that already ended speak over a read still pending', () => {
    expect(
      documentReadingState({
        textStatus: 'running',
        status: 'failed',
        errorCode: 'embedding_upstream',
      }),
    ).toEqual({ kind: 'indexFailed' });
    expect(
      documentReadingState({ textStatus: 'queued', status: 'unsupported' }),
    ).toEqual({ kind: 'unsupported' });
    expect(
      documentReadingState({ textStatus: 'queued', status: 'completed' }),
    ).toEqual({ kind: 'ready' });
  });

  it('lets a refusal of the index speak over a pending read', () => {
    expect(
      documentReadingState({
        textStatus: 'running',
        status: 'failed',
        errorCode: 'secret_detected',
      }),
    ).toEqual({ kind: 'refused', code: 'secret_detected' });
  });

  it('lets a read that checked the text speak over an index that could not scan it', () => {
    expect(
      documentReadingState({
        textStatus: 'ready',
        status: 'failed',
        errorCode: 'pii_scan_failed',
      }),
    ).toEqual({ kind: 'ready' });
  });

  it('reads a decided read, whatever the index does', () => {
    expect(
      documentReadingState({ textStatus: 'ready', status: 'failed' }),
    ).toEqual({ kind: 'ready' });
    expect(
      documentReadingState({
        textStatus: 'refused',
        textErrorCode: 'pii_blocked',
        status: 'queued',
      }),
    ).toEqual({ kind: 'refused', code: 'pii_blocked' });
  });
});
