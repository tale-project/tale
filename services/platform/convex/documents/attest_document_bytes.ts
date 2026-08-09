'use node';

import { ConvexError } from 'convex/values';
import { fileTypeFromBuffer } from 'file-type';

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

function invalidType() {
  return new ConvexError({
    code: 'UPLOAD_MIME_MISMATCH',
    message: 'The file contents do not match the selected document format.',
  });
}

const CFB_FREE_SECTOR = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;

function cfbDirectoryStreamNames(bytes: Uint8Array): Set<string> | null {
  if (bytes.byteLength < 512) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(28, true) !== 0xfffe || view.getUint16(32, true) !== 6) {
    return null;
  }
  const majorVersion = view.getUint16(26, true);
  const sectorShift = view.getUint16(30, true);
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
    sectorOffset(sectorId) + sectorSize <= bytes.byteLength;

  const numberOfFatSectors = view.getUint32(44, true);
  const numberOfDifatSectors = view.getUint32(72, true);
  const maximumSectors = Math.floor(bytes.byteLength / sectorSize) - 1;
  if (
    numberOfFatSectors > maximumSectors ||
    numberOfDifatSectors > maximumSectors
  ) {
    return null;
  }
  const fatSectorIds: number[] = [];
  for (let index = 0; index < 109; index++) {
    const sectorId = view.getUint32(76 + index * 4, true);
    if (sectorId !== CFB_FREE_SECTOR) fatSectorIds.push(sectorId);
  }
  let difatSector = view.getUint32(68, true);
  const difatEntriesPerSector = sectorSize / 4 - 1;
  for (
    let index = 0;
    index < numberOfDifatSectors && difatSector !== CFB_END_OF_CHAIN;
    index++
  ) {
    if (!sectorExists(difatSector)) return null;
    const offset = sectorOffset(difatSector);
    for (let entry = 0; entry < difatEntriesPerSector; entry++) {
      const sectorId = view.getUint32(offset + entry * 4, true);
      if (sectorId !== CFB_FREE_SECTOR) fatSectorIds.push(sectorId);
    }
    difatSector = view.getUint32(offset + difatEntriesPerSector * 4, true);
  }
  if (fatSectorIds.length < numberOfFatSectors) return null;

  const fat: number[] = [];
  for (const sectorId of fatSectorIds.slice(0, numberOfFatSectors)) {
    if (!sectorExists(sectorId)) return null;
    const offset = sectorOffset(sectorId);
    for (let entry = 0; entry < sectorSize / 4; entry++) {
      fat.push(view.getUint32(offset + entry * 4, true));
    }
  }

  const names = new Set<string>();
  let directorySector = view.getUint32(48, true);
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
    const offset = sectorOffset(directorySector);
    for (let entry = 0; entry < sectorSize / 128; entry++) {
      const entryOffset = offset + entry * 128;
      const objectType = view.getUint8(entryOffset + 66);
      const nameLength = view.getUint16(entryOffset + 64, true);
      if (
        objectType !== 2 ||
        nameLength < 2 ||
        nameLength > 64 ||
        nameLength % 2 !== 0
      ) {
        continue;
      }
      const nameBytes = bytes.subarray(
        entryOffset,
        entryOffset + nameLength - 2,
      );
      names.add(new TextDecoder('utf-16le').decode(nameBytes));
    }
    directorySector = fat[directorySector] ?? CFB_END_OF_CHAIN;
  }
  return names;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  let controls = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      controls++;
    }
  }
  return controls <= Math.max(1, Math.floor(text.length / 100));
}

/**
 * Derive the authoritative MIME from uploaded bytes.
 *
 * `file-type` owns binary signatures and ZIP-container inspection. The two
 * families it intentionally cannot distinguish are handled narrowly:
 * UTF-8 text is split into CSV/TXT by the requested extension, and legacy
 * Compound File Binary Office documents must contain their format-specific
 * directory stream name before the corresponding MIME is accepted.
 */
export async function attestDocumentContentType(
  bytes: Uint8Array,
  fileName: string,
): Promise<string> {
  const extension = extractExtension(fileName);
  if (extension === undefined) throw invalidType();

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(bytes);
  } catch {
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
      ? cfbDirectoryStreamNames(bytes)
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

  if (
    (extension === 'csv' || extension === 'txt') &&
    detected === undefined &&
    isUtf8Text(bytes)
  ) {
    return extension === 'csv' ? 'text/csv' : 'text/plain';
  }

  throw invalidType();
}
