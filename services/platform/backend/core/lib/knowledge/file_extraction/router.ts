'use node';

/**
 * File extraction router for a file on disk: the text `extractDocument`
 * returns for the same bytes is written to a sink, and what the extraction
 * learned about the file is answered.
 *
 * The file is read as its format allows, never held whole where that can be
 * helped: a spreadsheet row by row, a PDF by the ranges its pages need, an
 * Office or OpenDocument file by the parts its text is in, a text file a
 * piece at a time (tale-project/tale#4942). There is no vision client on
 * this path: no caller has one, and the heavy slot's child, which this is
 * for, could not reach it.
 *
 * The readers of bytes are next door, in `extraction/`, and stay free of
 * files: a data migration reaches their by-name rules, and what a
 * migration reaches may open nothing
 * (`backend/db/data-migrations.test.ts`).
 */

import { extname } from 'node:path';

import { extractTextFromDocxZip } from '../extraction/docx';
import { extractTextFromImageBytes } from '../extraction/image';
import { extractTextFromOdtZip } from '../extraction/odt';
import type { ProgressCallback } from '../extraction/pdf';
import { extractTextFromPptxZip } from '../extraction/pptx';
import { documentKind, type ExtractedFacts } from '../extraction/router';
import { extractTextFromPdfFile } from './pdf_file';
import { extractTextFromTextFile } from './text_file';
import type { TextSink } from './text_sink';
import { extractTextFromXlsxFile } from './xlsx_stream';
import { openGuardedZip } from './zip_file';

export interface ExtractFileOptions {
  processImages?: boolean;
  onProgress?: ProgressCallback;
  /** The most pixels of one image a PDF's reader may decode (`pdf.ts`). */
  maxImagePixels?: number;
  /** How much of a PDF its reader may have loaded before it opens the
   * document again (`pdf.ts`). */
  reopenAfterBytes?: number;
}

/**
 * Write the text of the file at `path` to `sink`, routing by `filename` as
 * `extractDocument` routes bytes, and answer what the extraction learned.
 * Throws what `extractDocument` throws for the same file.
 */
export async function extractDocumentFile(
  path: string,
  filename: string,
  sink: TextSink,
  options: ExtractFileOptions = {},
): Promise<ExtractedFacts> {
  const processImages = options.processImages ?? true;
  const kind = documentKind(filename);

  switch (kind) {
    case 'pdf':
      return await extractTextFromPdfFile(path, sink, filename, {
        visionClient: null,
        processImages,
        onProgress: options.onProgress,
        maxImagePixels: options.maxImagePixels,
        reopenAfterBytes: options.reopenAfterBytes,
      });
    case 'xlsx':
      await extractTextFromXlsxFile(path, sink, filename);
      return { visionUsed: false };
    case 'docx':
    case 'pptx':
    case 'odt': {
      const zip = await openGuardedZip(path);
      try {
        const [text, visionUsed] =
          kind === 'docx'
            ? await extractTextFromDocxZip(zip, filename, {
                visionClient: null,
                processImages,
              })
            : kind === 'pptx'
              ? await extractTextFromPptxZip(zip, filename, {
                  visionClient: null,
                  processImages,
                })
              : await extractTextFromOdtZip(zip, filename, { processImages });
        await sink.write(text);
        return { visionUsed };
      } finally {
        zip.close();
      }
    }
    case 'image': {
      // A picture is read by a vision client alone, and there is none here:
      // the same answer, and the same warning, without its bytes.
      const [text, visionUsed] = await extractTextFromImageBytes(
        new Uint8Array(),
        filename,
        { visionClient: null },
      );
      await sink.write(text);
      return { visionUsed };
    }
    case 'text':
      await extractTextFromTextFile(path, sink, filename);
      return { visionUsed: false };
    default: {
      // In the words of the reader of bytes, for a name it refuses.
      const suffix = extname(filename).toLowerCase();
      console.warn(`Unsupported file type: ${suffix}`);
      throw new Error(`Unsupported file type: ${suffix}`);
    }
  }
}
