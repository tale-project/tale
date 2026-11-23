/**
 * Where a staged document stands for the assistant — one decision for the
 * chip, the toasts and the send gate's words. A read still to come is
 * "Reading…"; once the read is decided, the read speaks, whatever the index
 * does. A read whose job was lost does not spin for good: when the file's
 * index already ended, the index's state speaks until the read watchdog
 * settles the read.
 */

import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { memoryLimitSentence } from '@/lib/shared/memory-limit';

import {
  documentChipStatus,
  documentReadingState,
} from './document-chip-status';

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

/**
 * A file that needs more memory than this server gives one file fails its
 * index for good until an administrator raises the limit. The server stores
 * the limit in its sentence; the chip says it in the reader's language,
 * with the number and the setting.
 */
describe('a document that needs more memory than one file is given', () => {
  const failed = {
    textStatus: 'deferred',
    textErrorCode: 'read_failed',
    status: 'failed',
    errorCode: 'memory_limit',
    error: memoryLimitSentence(96),
  } as const;
  // The catalog's own words are tested where the catalog is rendered: here,
  // what is asked of it.
  const asked: { key: string; params: unknown }[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a translator that records what it was asked
  const t = ((key: string, params?: unknown) => {
    asked.push({ key, params });
    return key;
  }) as unknown as TFunction;
  const attachment = {
    fileName: 'ledger.xlsx',
    fileType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 9_000_000,
  };

  it('reads the limit out of the stored sentence', () => {
    expect(documentReadingState(failed)).toEqual({
      kind: 'indexFailed',
      memoryLimitMb: 96,
    });
  });

  it('says so on the chip, and names the limit and the setting in its reason', () => {
    asked.length = 0;
    expect(documentChipStatus(t, attachment, failed)).toEqual({
      label: 'documentTooHeavy',
      failed: true,
      busy: false,
      detail: 'documentTooHeavyDescription',
    });
    expect(asked).toContainEqual({
      key: 'documentTooHeavyDescription',
      params: {
        filename: 'ledger.xlsx',
        limit: 96,
        setting: 'HEAVY_SLOT_MEMORY_MB',
      },
    });
  });

  it('is an ordinary failed index when the sentence names no limit', () => {
    const unnamed = { ...failed, error: 'Indexing failed.' };
    expect(documentReadingState(unnamed)).toEqual({ kind: 'indexFailed' });
    expect(documentChipStatus(t, attachment, unnamed)).toMatchObject({
      label: 'indexingFailed',
      detail: 'indexingFailedDescription',
    });
  });

  it('does not read a limit into another failure whose words happen to match', () => {
    expect(
      documentReadingState({
        ...failed,
        errorCode: 'indexer_error',
      }),
    ).toEqual({ kind: 'indexFailed' });
  });
});
