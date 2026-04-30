import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';

import { parseUploadedConfigs } from './parse-uploaded-configs';

function makeJsonFile(name: string, value: unknown, relPath?: string) {
  const file = new File([JSON.stringify(value)], name, {
    type: 'application/json',
  });
  if (relPath) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  }
  return file;
}

async function makeZip(files: Record<string, unknown>, name = 'archive.zip') {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) {
    zip.file(path, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, { type: 'application/zip' });
}

describe('parseUploadedConfigs', () => {
  it('parses a single .json file using its filename as relPath/baseName', async () => {
    const file = makeJsonFile('agent.json', { hello: 'world' });
    const result = await parseUploadedConfigs([file]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      relPath: 'agent.json',
      baseName: 'agent',
      json: { hello: 'world' },
    });
    expect(result[0].error).toBeUndefined();
  });

  it('marks invalid JSON files as errors but does not throw', async () => {
    const bad = new File(['{ not json'], 'bad.json', {
      type: 'application/json',
    });
    const good = makeJsonFile('good.json', { ok: true });
    const result = await parseUploadedConfigs([bad, good]);
    expect(result).toHaveLength(2);
    expect(result[0].error).toBeDefined();
    expect(result[0].json).toBeUndefined();
    expect(result[1].json).toEqual({ ok: true });
  });

  it('rejects unsupported file types', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const result = await parseUploadedConfigs([file]);
    expect(result).toHaveLength(1);
    expect(result[0].error).toMatch(/unsupported/i);
  });

  it('preserves the picked folder as the first segment of relPath', async () => {
    const file = makeJsonFile(
      'sync.json',
      { name: 'Sync' },
      'contracts/sync.json',
    );
    const result = await parseUploadedConfigs([file]);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe('contracts/sync.json');
    expect(result[0].baseName).toBe('sync');
  });

  it('extracts .json entries from a zip archive and ignores other files', async () => {
    const zip = await makeZip({
      'foo.json': { id: 'foo' },
      'bar.json': { id: 'bar' },
      'README.md': 'docs',
    });
    const result = await parseUploadedConfigs([zip]);
    const slugs = result.map((r) => r.baseName).sort();
    expect(slugs).toEqual(['bar', 'foo']);
    expect(result.every((r) => r.error === undefined)).toBe(true);
  });

  it('strips a common root folder from a zip when every entry shares it', async () => {
    const zip = await makeZip({
      'workflows/general/foo.json': { id: 'foo' },
      'workflows/general/bar.json': { id: 'bar' },
    });
    const result = await parseUploadedConfigs([zip]);
    const paths = result.map((r) => r.relPath).sort();
    expect(paths).toEqual(['general/bar.json', 'general/foo.json']);
  });

  it('keeps the original paths when zip entries do not share a root folder', async () => {
    const zip = await makeZip({
      'foo.json': { id: 'foo' },
      'nested/bar.json': { id: 'bar' },
    });
    const result = await parseUploadedConfigs([zip]);
    const paths = result.map((r) => r.relPath).sort();
    expect(paths).toEqual(['foo.json', 'nested/bar.json']);
  });

  it('mixes file, folder, and zip inputs in a single call', async () => {
    const flat = makeJsonFile('flat.json', { id: 'flat' });
    const folderFile = makeJsonFile(
      'foo.json',
      { id: 'folder-foo' },
      'pickedfolder/foo.json',
    );
    // pickedfolder is preserved as the first slug segment
    const zip = await makeZip({ 'inside.json': { id: 'inside' } });
    const result = await parseUploadedConfigs([flat, folderFile, zip]);
    const ids = result.map((r) => (r.json as { id: string }).id).sort();
    expect(ids).toEqual(['flat', 'folder-foo', 'inside']);
  });

  it('reports an error on every entry when the upload exceeds the size limit', async () => {
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.json', {
      type: 'application/json',
    });
    const result = await parseUploadedConfigs([big]);
    expect(result).toHaveLength(1);
    expect(result[0].error).toMatch(/limit/i);
  });
});
