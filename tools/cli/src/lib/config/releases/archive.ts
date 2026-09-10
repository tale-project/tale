import CRC32 from 'crc-32';
import JSZip from 'jszip';
import { fromBufferPromise, type Entry as ZipEntry } from 'yauzl';

import { insist, relativePath } from './model';

export interface Entry {
  path: string;
  bytes: Buffer;
  executable: boolean;
}
export async function archive(entries: Entry[]): Promise<Buffer> {
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    relativePath.parse(entry.path);
    insist(!seen.has(entry.path), 'duplicate archive path');
    seen.add(entry.path);
    zip.file(entry.path, entry.bytes, {
      createFolders: false,
      date: new Date('2000-01-01T00:00:00Z'),
      unixPermissions: entry.executable ? 0o100755 : 0o100644,
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
    platform: 'UNIX',
  });
}
/** Inspect the entire central directory before opening an inflate stream.
 * JSZip's name map hides duplicates and CRC loading eagerly inflates bodies;
 * yauzl exposes raw entries and checks declared sizes during bounded reads. */
export async function unpack(bytes: Buffer): Promise<Entry[]> {
  const zip = await fromBufferPromise(bytes, {
    strictFileNames: true,
    validateEntrySizes: true,
  });
  try {
    insist(
      zip.entryCount > 0 && zip.entryCount <= 5000,
      'invalid archive file count',
    );
    const metadata: ZipEntry[] = [];
    const names = new Set<string>();
    let declared = 0;
    for await (const file of zip.eachEntry()) {
      const directory = file.fileName.endsWith('/');
      const name = directory ? file.fileName.slice(0, -1) : file.fileName;
      relativePath.parse(name);
      insist(!names.has(name), 'duplicate archive path');
      names.add(name);
      const mode = file.externalFileAttributes >>> 16;
      insist(
        (mode & 0o170000) === 0 ||
          (mode & 0o170000) === (directory ? 0o040000 : 0o100000),
        'archive must contain only regular files',
      );
      insist(!file.isEncrypted(), 'encrypted archive is unsupported');
      if (directory) continue;
      declared += file.uncompressedSize;
      insist(
        file.uncompressedSize <= 25_000_000 && declared <= 100_000_000,
        'archive exceeds native size limit',
      );
      metadata.push(file);
    }
    const entries: Entry[] = [];
    for (const file of metadata) {
      const stream = await zip.openReadStreamPromise(file);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          const data = Buffer.from(chunk as Uint8Array);
          size += data.length;
          insist(
            size <= file.uncompressedSize,
            'archive body exceeds declared size',
          );
          chunks.push(data);
        }
      } finally {
        stream.destroy();
      }
      const content = Buffer.concat(chunks);
      insist(
        content.length === file.uncompressedSize &&
          CRC32.buf(content) >>> 0 === file.crc32,
        'archive checksum/size mismatch',
      );
      entries.push({
        path: file.fileName,
        bytes: content,
        executable: ((file.externalFileAttributes >>> 16) & 0o111) !== 0,
      });
    }
    insist(entries.length > 0, 'archive has no files');
    return entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  } finally {
    zip.close();
  }
}
/** This matches Tale's native import/staging policy. Historical archives retain
 * excluded source files, but their native checksums describe only installed assets. */
export const excludedNativePath = (name: string): boolean =>
  name
    .split('/')
    .some(
      (part) =>
        part.startsWith('.') || ['__pycache__', 'node_modules'].includes(part),
    );
