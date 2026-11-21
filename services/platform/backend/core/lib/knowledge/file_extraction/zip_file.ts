'use node';

/**
 * An archive read from a file on disk.
 *
 * Its parts are found through its central directory and inflated one at a
 * time, when asked for: a document whose megabytes are its pictures costs
 * the reader its text (tale-project/tale#4942).
 */

import { open, readFile, type FileHandle } from 'node:fs/promises';

import { openPromise, type Entry, type ZipFile } from 'yauzl';

import { GuardedZip, type ZipBacking } from '../extraction/ooxml';

/** An archive on disk, read through its central directory. */
class FileBacking implements ZipBacking {
  constructor(
    private readonly zip: ZipFile,
    private readonly entries: ReadonlyMap<string, Entry>,
  ) {}

  names(): string[] {
    return [...this.entries.keys()];
  }

  statedSize(path: string): number | null {
    return this.entries.get(path)?.uncompressedSize ?? null;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(path);
    if (entry === undefined) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await this.zip.openReadStreamPromise(entry)) {
      chunks.push(chunk);
    }
    // A plain view of the bytes, as the reader from memory answers.
    const whole = Buffer.concat(chunks);
    return new Uint8Array(whole.buffer, whole.byteOffset, whole.byteLength);
  }

  close(): void {
    this.zip.close();
  }
}

/** The signature a part's own header opens with. */
const LOCAL_HEADER = 0x04034b50;
/** The fixed part of that header: the name follows it. */
const LOCAL_HEADER_BYTES = 30;
/** The flag that says a name is written in UTF-8. */
const UTF8_NAMES = 0x800;

/**
 * Whether a part's name is one every reader finds it by. JSZip tidies a name
 * before it files the part (`a//b`, `./a` and `a/./b` all become one path),
 * and yauzl files it as written: a reader that asks for `word/document.xml`
 * finds it in one and not in the other.
 */
function isPlainName(name: string): boolean {
  if (name === '' || name.startsWith('/')) return false;
  const segments = name.split('/');
  // A folder is named with a slash at its end.
  if (segments.at(-1) === '') segments.pop();
  return segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..',
  );
}

/**
 * The name a part's own header gives it, or `null` where there is no such
 * header. The directory at the archive's end names every part a second
 * time, and the two can differ: JSZip files a part under the name in its own
 * header, yauzl under the directory's.
 */
async function ownName(file: FileHandle, entry: Entry): Promise<Buffer | null> {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  const at = entry.relativeOffsetOfLocalHeader;
  const { bytesRead } = await file.read(header, 0, LOCAL_HEADER_BYTES, at);
  if (bytesRead !== LOCAL_HEADER_BYTES) return null;
  if (header.readUInt32LE(0) !== LOCAL_HEADER) return null;
  const name = Buffer.alloc(header.readUInt16LE(26));
  const read = await file.read(name, 0, name.length, at + LOCAL_HEADER_BYTES);
  return read.bytesRead === name.length ? name : null;
}

/**
 * Open an archive on disk and list its parts. Rejects when yauzl cannot
 * read it as a zip, and when the archive is written in a way that JSZip,
 * which reads it from memory, would read differently: a part named twice,
 * a name that is not a plain path or not in UTF-8, a part whose own header
 * calls it something else. Which reading is meant cannot be told here, so
 * the caller reads such an archive whole, as it always was.
 */
export async function openZipFile(
  path: string,
): Promise<{ zip: ZipFile; entries: Map<string, Entry> }> {
  const zip = await openPromise(path, {
    lazyEntries: true,
    autoClose: false,
    // A backslash in a name stays a backslash, and ends the attempt.
    strictFileNames: true,
  });
  try {
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) {
      // Of two parts with one name JSZip keeps the last.
      if (entries.has(entry.fileName)) {
        throw new Error(`the archive names ${entry.fileName} twice`);
      }
      if (!isPlainName(entry.fileName)) {
        throw new Error('the archive names a part by a path that is not plain');
      }
      // Without the flag yauzl reads a name as code page 437 and JSZip as
      // UTF-8: the two agree on ASCII alone.
      if (
        (entry.generalPurposeBitFlag & UTF8_NAMES) === 0 &&
        entry.fileNameRaw.some((byte) => byte > 0x7f)
      ) {
        throw new Error('the archive names a part outside ASCII, not in UTF-8');
      }
      entries.set(entry.fileName, entry);
    }
    const file = await open(path, 'r');
    try {
      for (const entry of entries.values()) {
        const own = await ownName(file, entry);
        if (own === null || !own.equals(entry.fileNameRaw)) {
          throw new Error(
            'the archive names a part differently in its two places',
          );
        }
      }
    } finally {
      await file.close();
    }
    return { zip, entries };
  } catch (error) {
    zip.close();
    throw error;
  }
}

/**
 * Open the archive at `path` for the readers of `extraction/`.
 *
 * An archive this reader refuses — a part named twice, a name the two
 * readers would file differently, a directory that disagrees with its
 * entries — is read whole, as `GuardedZip.load` reads one: a file that was
 * readable stays readable, and reads as it did, at the cost of its size in
 * memory.
 */
export async function openGuardedZip(
  path: string,
  maxUncompressed?: number,
): Promise<GuardedZip> {
  try {
    const { zip, entries } = await openZipFile(path);
    return GuardedZip.over(new FileBacking(zip, entries), maxUncompressed);
  } catch (error) {
    console.warn(
      `[extraction] reading an archive whole, which could not be read by part: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return await GuardedZip.load(await readFile(path), maxUncompressed);
  }
}
