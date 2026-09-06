// The org-scoped `ctx.files` sink: bytes land in the org's blob store through
// the files domain, a metadata row names the connector as their source, and
// the body receives the blob ref as its handle.

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteOrgBlobRefs,
  putOrgBlobBytes,
  registerUploadedBytes,
} from '../files/service.ts';
import { connectorBlobSink } from './blob-sink.ts';

vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(),
  putOrgBlobBytes: vi.fn(),
  registerUploadedBytes: vi.fn(),
}));

const sql = {} as unknown as Sql;

beforeEach(() => {
  vi.mocked(deleteOrgBlobRefs).mockReset();
  vi.mocked(deleteOrgBlobRefs).mockResolvedValue(undefined);
  vi.mocked(putOrgBlobBytes).mockReset();
  vi.mocked(registerUploadedBytes).mockReset();
  vi.mocked(putOrgBlobBytes).mockResolvedValue('s3:org-1/blob-1');
  vi.mocked(registerUploadedBytes).mockResolvedValue({ fileId: 'file-1' });
});

describe('connectorBlobSink', () => {
  it('stores decoded base64 bytes in the org store and returns the blob ref', async () => {
    const sink = connectorBlobSink(sql, {
      organizationId: 'org-1',
      connector: 'gmail',
      caller: { kind: 'workflow', runId: 'run-1', nodeId: 'n1' },
    });
    const bytes = Buffer.from([1, 2, 3, 4]);

    const stored = await sink.store({
      data: bytes.toString('base64'),
      encoding: 'base64',
      contentType: 'application/pdf',
      fileName: 'invoice.pdf',
    });

    expect(stored).toEqual({
      id: 's3:org-1/blob-1',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4,
    });
    expect(vi.mocked(putOrgBlobBytes)).toHaveBeenCalledWith(sql, 'org-1', {
      bytes: Uint8Array.from(bytes),
      contentType: 'application/pdf',
    });
    // The metadata row names the connector as the source, is not RAG-indexed
    // (nothing scopes it yet), and carries no uploader for a run.
    expect(vi.mocked(registerUploadedBytes)).toHaveBeenCalledWith(sql, {
      organizationId: 'org-1',
      storageRef: 's3:org-1/blob-1',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4,
      source: 'gmail',
      skipRagIndexing: true,
    });
  });

  it('encodes utf-8 data and attributes a user caller as the uploader', async () => {
    const sink = connectorBlobSink(sql, {
      organizationId: 'org-1',
      connector: 'confluence',
      caller: { kind: 'user', userId: 'user-9' },
    });

    const stored = await sink.store({
      data: 'héllo',
      encoding: 'utf-8',
      contentType: 'text/plain',
      fileName: 'note.txt',
    });

    expect(stored.size).toBe(Buffer.byteLength('héllo', 'utf8'));
    expect(vi.mocked(registerUploadedBytes)).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ uploadedBy: 'user-9', source: 'confluence' }),
    );
  });

  it('surfaces a refused blob write and registers nothing', async () => {
    vi.mocked(putOrgBlobBytes).mockRejectedValue(
      new Error('Invalid blob size'),
    );
    const sink = connectorBlobSink(sql, {
      organizationId: 'org-1',
      connector: 'gmail',
      caller: { kind: 'system', reason: 'test' },
    });

    await expect(
      sink.store({
        data: '',
        encoding: 'base64',
        contentType: 'application/pdf',
        fileName: 'empty.pdf',
      }),
    ).rejects.toThrow('Invalid blob size');
    expect(vi.mocked(registerUploadedBytes)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteOrgBlobRefs)).not.toHaveBeenCalled();
  });

  it('reclaims the stored blob when the metadata row cannot be written', async () => {
    vi.mocked(registerUploadedBytes).mockRejectedValue(
      new Error('Insert failed'),
    );
    const sink = connectorBlobSink(sql, {
      organizationId: 'org-1',
      connector: 'gmail',
      caller: { kind: 'workflow', runId: 'run-1', nodeId: 'n1' },
    });

    await expect(
      sink.store({
        data: Buffer.from([1, 2, 3]).toString('base64'),
        encoding: 'base64',
        contentType: 'application/pdf',
        fileName: 'orphan.pdf',
      }),
    ).rejects.toThrow('Insert failed');
    // The bytes landed before the row failed: nothing lists them, so they
    // are handed back to the org store rather than left behind.
    expect(vi.mocked(deleteOrgBlobRefs)).toHaveBeenCalledWith(sql, 'org-1', [
      's3:org-1/blob-1',
    ]);
  });
});
