'use node';

import { open } from 'node:fs/promises';

import { piecesOfFile } from '../lib/knowledge/file_extraction/file_pieces';
import { fileTypeOfFile } from '../lib/knowledge/file_extraction/sniff_file';
import { attestDocumentSource } from './attest_document_bytes';

/**
 * Derive the authoritative MIME of a document that is in a file: what
 * `attestDocumentContentType` answers for the same bytes, without the file
 * ever being read whole. A replacement document may be 100 MiB, and its
 * attestation used to hold it, and for a text the string it decodes to as
 * well (tale-project/tale#4942).
 */
export async function attestDocumentFile(
  filePath: string,
  fileName: string,
): Promise<string> {
  const file = await open(filePath, 'r');
  try {
    const { size } = await file.stat();
    return await attestDocumentSource(
      {
        size,
        detect: () => fileTypeOfFile(filePath),
        read: async (offset, length) => {
          const buffer = Buffer.allocUnsafe(length);
          let filled = 0;
          while (filled < length) {
            const { bytesRead } = await file.read(
              buffer,
              filled,
              length - filled,
              offset + filled,
            );
            if (bytesRead === 0) break;
            filled += bytesRead;
          }
          return buffer.subarray(0, filled);
        },
        pieces: () => piecesOfFile(filePath),
      },
      fileName,
    );
  } finally {
    await file.close();
  }
}
