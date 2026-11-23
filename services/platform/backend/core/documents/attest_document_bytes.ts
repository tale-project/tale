'use node';

import { fileTypeFromBuffer } from 'file-type';

import { AppError } from '../../../lib/shared/errors/app-error';
import { extractExtension } from './extract_extension';

const DETECTED_DOCUMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const LEGACY_OFFICE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  xls: 'application/vnd.ms-excel',
};

const LEGACY_OFFICE_STREAM_BY_EXTENSION: Readonly<Record<string, string[]>> = {
  doc: ['WordDocument'],
  ppt: ['PowerPoint Document'],
  xls: ['Workbook', 'Book'],
};

/**
 * The UTF-8 text family `file-type` has no signature for, split by the
 * requested extension — every text-typed member of
 * `DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS` (the upload lane's floor) must appear
 * here, or a document of that type uploads fine and can never be replaced.
 */
const UTF8_TEXT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  py: 'text/x-python',
};

/**
 * Opaque vendor containers the upload lane admits as blobs: no signature to
 * check, no parser, no preview — the bytes are attested only as "not a
 * document of another format" and stored as an octet stream. The format is
 * proprietary (Banana's `.ac2`: "compacted and stored as a single block", no
 * published magic number), so the container may well carry a generic
 * signature (ZIP, gzip, CFB) — those pass; only a signature ANOTHER allowed
 * document type claims is refused, or a real ledger could never be replaced.
 */
const OPAQUE_CONTAINER_EXTENSIONS: ReadonlySet<string> = new Set(['ac2']);

const CLAIMED_DETECTED_MIMES: ReadonlySet<string> = new Set(
  Object.values(DETECTED_DOCUMENT_MIME_BY_EXTENSION),
);

/**
 * A document's bytes, read where they are: in memory, or in a file that is
 * never read whole (`attest_document_file.ts`). The attestation asks for
 * no more of a document than its answer needs.
 */
export interface DocumentBytes {
  readonly size: number;
  /** What `file-type` makes of the document: its signature, or the
   * container it is. */
  detect(): Promise<{ mime: string } | undefined>;
  /** `length` bytes from `offset`. Only asked for bytes that are there. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** The whole document, in order, a piece at a time. A piece is only read
   * until the next one is asked for. */
  pieces(): AsyncIterable<Uint8Array>;
}

/**
 * Whether detected bytes are a document of a type some OTHER allowed
 * extension owns — a signature-detected type in the map, or a legacy Office
 * Compound File carrying one of the format-specific directory streams.
 */
async function isClaimedByDocumentType(
  detected: { mime: string } | undefined,
  source: DocumentBytes,
): Promise<boolean> {
  if (detected === undefined) return false;
  if (CLAIMED_DETECTED_MIMES.has(detected.mime)) return true;
  if (detected.mime !== 'application/x-cfb') return false;
  const streams = await cfbDirectoryStreamNames(source);
  if (streams === null) return false;
  return Object.values(LEGACY_OFFICE_STREAM_BY_EXTENSION).some((names) =>
    names.some((stream) => streams.has(stream)),
  );
}

function invalidType() {
  return new AppError({
    code: 'UPLOAD_MIME_MISMATCH',
    message: 'The file contents do not match the selected document format.',
  });
}

const CFB_FREE_SECTOR = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * The names of the streams a Compound File's directory lists, or `null`
 * for bytes that are no such file. Read a sector at a time: the header,
 * the allocation table's sectors, and the directory's chain through them.
 */
async function cfbDirectoryStreamNames(
  source: DocumentBytes,
): Promise<Set<string> | null> {
  if (source.size < 512) return null;
  const header = viewOf(await source.read(0, 512));
  if (
    header.getUint16(28, true) !== 0xfffe ||
    header.getUint16(32, true) !== 6
  ) {
    return null;
  }
  const majorVersion = header.getUint16(26, true);
  const sectorShift = header.getUint16(30, true);
  if (
    (majorVersion !== 3 || sectorShift !== 9) &&
    (majorVersion !== 4 || sectorShift !== 12)
  ) {
    return null;
  }
  const sectorSize = 2 ** sectorShift;
  const sectorOffset = (sectorId: number): number =>
    (sectorId + 1) * sectorSize;
  const sectorExists = (sectorId: number): boolean =>
    Number.isInteger(sectorId) &&
    sectorId >= 0 &&
    sectorOffset(sectorId) + sectorSize <= source.size;
  const sector = async (sectorId: number): Promise<DataView> =>
    viewOf(await source.read(sectorOffset(sectorId), sectorSize));

  const numberOfFatSectors = header.getUint32(44, true);
  const numberOfDifatSectors = header.getUint32(72, true);
  const maximumSectors = Math.floor(source.size / sectorSize) - 1;
  if (
    numberOfFatSectors > maximumSectors ||
    numberOfDifatSectors > maximumSectors
  ) {
    return null;
  }
  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109; index++) {
    const sectorId = header.getUint32(76 + index * 4, true);
    if (sectorId !== CFB_FREE_SECTOR) fatSectorIds.push(sectorId);
  }
  let difatSector = header.getUint32(68, true);
  const difatEntriesPerSector = sectorSize / 4 - 1;
  for (
    let index = 0;
    index < numberOfDifatSectors && difatSector !== CFB_END_OF_CHAIN;
    index++
  ) {
    if (!sectorExists(difatSector)) return null;
    const difat = await sector(difatSector);
    for (let entry = 0; entry < difatEntriesPerSector; entry++) {
      const sectorId = difat.getUint32(entry * 4, true);
      if (sectorId !== CFB_FREE_SECTOR) fatSectorIds.push(sectorId);
    }
    difatSector = difat.getUint32(difatEntriesPerSector * 4, true);
  }
  if (fatSectorIds.length < numberOfFatSectors) return null;

  const fat: number[] = [];
  for (const sectorId of fatSectorIds.slice(0, numberOfFatSectors)) {
    if (!sectorExists(sectorId)) return null;
    const table = await sector(sectorId);
    for (let entry = 0; entry < sectorSize / 4; entry++) {
      fat.push(table.getUint32(entry * 4, true));
    }
  }

  const names = new Set<string>();
  let directorySector = header.getUint32(48, true);
  const visited = new Set<number>();
  while (directorySector !== CFB_END_OF_CHAIN) {
    if (
      visited.has(directorySector) ||
      !sectorExists(directorySector) ||
      directorySector >= fat.length
    ) {
      return null;
    }
    visited.add(directorySector);
    const directory = await source.read(
      sectorOffset(directorySector),
      sectorSize,
    );
    const entries = viewOf(directory);
    for (let entry = 0; entry < sectorSize / 128; entry++) {
      const entryOffset = entry * 128;
      const objectType = entries.getUint8(entryOffset + 66);
      const nameLength = entries.getUint16(entryOffset + 64, true);
      if (
        objectType !== 2 ||
        nameLength < 2 ||
        nameLength > 64 ||
        nameLength % 2 !== 0
      ) {
        continue;
      }
      const nameBytes = directory.subarray(
        entryOffset,
        entryOffset + nameLength - 2,
      );
      names.add(new TextDecoder('utf-16le').decode(nameBytes));
    }
    directorySector = fat[directorySector] ?? CFB_END_OF_CHAIN;
  }
  return names;
}

/**
 * Whether the document is UTF-8 text: no NUL, every byte part of a valid
 * sequence, and no more than one control character in a hundred. Decoded a
 * piece at a time, so that a text is never held as bytes and as the string
 * they make at once.
 */
async function isUtf8Text(source: DocumentBytes): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let controls = 0;
  const count = (text: string): void => {
    length += text.length;
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        controls++;
      }
    }
  };
  try {
    for await (const piece of source.pieces()) {
      if (piece.includes(0)) return false;
      count(decoder.decode(piece, { stream: true }));
    }
    // A sequence the document's end cuts short is not UTF-8 either.
    count(decoder.decode());
  } catch (error) {
    // The decoder's only complaint is bytes that are not UTF-8; anything
    // else is the reader's, and is not an answer about the document.
    if (error instanceof TypeError) return false;
    throw error;
  }
  return controls <= Math.max(1, Math.floor(length / 100));
}

/**
 * Derive the authoritative MIME from a document's bytes, wherever they
 * are.
 *
 * `file-type` owns binary signatures and ZIP-container inspection. The
 * families it intentionally cannot distinguish are handled narrowly:
 * UTF-8 text is split by the requested extension
 * (`UTF8_TEXT_MIME_BY_EXTENSION`), legacy Compound File Binary Office
 * documents must contain their format-specific directory stream name before
 * the corresponding MIME is accepted, and an opaque vendor container is
 * admitted unless the bytes are a document some other allowed type claims.
 */
export async function attestDocumentSource(
  source: DocumentBytes,
  fileName: string,
): Promise<string> {
  const extension = extractExtension(fileName);
  if (extension === undefined) throw invalidType();

  let detected: { mime: string } | undefined;
  try {
    detected = await source.detect();
  } catch (error) {
    // `file-type` answers some bytes it cannot read by throwing: they are of
    // no type it knows. It is said aloud, because a detector that fails for
    // every document, as a packaging mistake makes it, looks the same from
    // here and would refuse every replacement as a mismatch.
    console.warn(
      '[documents] the type of a document could not be read from its bytes:',
      error instanceof Error ? error.message : error,
    );
    detected = undefined;
  }

  const expectedDetectedMime = DETECTED_DOCUMENT_MIME_BY_EXTENSION[extension];
  if (
    expectedDetectedMime !== undefined &&
    detected?.mime === expectedDetectedMime
  ) {
    return expectedDetectedMime;
  }

  const legacyMime = LEGACY_OFFICE_MIME_BY_EXTENSION[extension];
  const legacyStreams =
    detected?.mime === 'application/x-cfb'
      ? await cfbDirectoryStreamNames(source)
      : null;
  if (
    legacyMime !== undefined &&
    legacyStreams !== null &&
    LEGACY_OFFICE_STREAM_BY_EXTENSION[extension]?.some((stream) =>
      legacyStreams.has(stream),
    )
  ) {
    return legacyMime;
  }

  const textMime = UTF8_TEXT_MIME_BY_EXTENSION[extension];
  if (
    textMime !== undefined &&
    detected === undefined &&
    (await isUtf8Text(source))
  ) {
    return textMime;
  }

  if (
    OPAQUE_CONTAINER_EXTENSIONS.has(extension) &&
    !(await isClaimedByDocumentType(detected, source))
  ) {
    return 'application/octet-stream';
  }

  throw invalidType();
}

/** {@link attestDocumentSource} for bytes in memory. */
export async function attestDocumentContentType(
  bytes: Uint8Array,
  fileName: string,
): Promise<string> {
  return attestDocumentSource(
    {
      size: bytes.byteLength,
      detect: () => fileTypeFromBuffer(bytes),
      read: (offset, length) =>
        Promise.resolve(bytes.subarray(offset, offset + length)),
      // oxlint-disable-next-line typescript/require-await -- one piece, as a sequence of pieces
      pieces: async function* pieces() {
        yield bytes;
      },
    },
    fileName,
  );
}
