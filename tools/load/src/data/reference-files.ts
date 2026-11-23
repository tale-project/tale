/**
 * The files of the memory budget's reference workload (tale#4942): a
 * spreadsheet and a PDF indexed at the same time, and one recording to
 * transcribe. Each is made here, deterministically, so every run indexes
 * the same bytes and no large file lives in the repository.
 *
 * - The spreadsheet has finding 1's shape, 60,000 rows by 10 columns of
 *   numbers, amounts and generated words, but is not its file: finding 1's
 *   was 8.4 MB and 3,745 chunks, and was not kept. This one is the stand-in
 *   the epic's lab measured the heavy slot with (unit 6), made the same
 *   way: written by SheetJS (the library the platform reads one with when
 *   its streaming reader declines), 14,980,313 bytes.
 * - The PDF is a text report: pages of Helvetica lines in Flate-compressed
 *   content streams, as a word processor exports one.
 * - The recording is a meeting's worth of speech-like sound: tone bursts
 *   with pauses, 16 kHz mono 16-bit PCM in a WAV, as a voice recorder
 *   writes one.
 */

import { deflateSync } from 'node:zlib';

import * as XLSX from 'xlsx';

import { mulberry32 } from '../runner/assign.ts';

export interface ReferenceFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** What it is, for the report. */
  readonly description: string;
}

export interface ReferenceFileOptions {
  /** Spreadsheet rows, the header included. */
  readonly rows?: number;
  readonly columns?: number;
  readonly pages?: number;
  readonly recordingSeconds?: number;
}

const REFERENCE_ROWS = 60_000;
const REFERENCE_COLUMNS = 10;
const REFERENCE_PAGES = 300;
const REFERENCE_RECORDING_SECONDS = 600;

/** One seed for every file: the epic's number. */
const SEED = 4942;

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SYLLABLES =
  'ka ro mi ten sul va lo pe dra qui non est bar fen gol hu ix jo ly ma'.split(
    ' ',
  );

function wordMaker(random: () => number): () => string {
  return () => {
    const length = 2 + Math.floor(random() * 3);
    let word = '';
    for (let index = 0; index < length; index += 1) {
      word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
    }
    return word;
  };
}

/** The reference spreadsheet: an `.xlsx` of `rows` × `columns`. */
export function referenceSpreadsheet(
  rows = REFERENCE_ROWS,
  columns = REFERENCE_COLUMNS,
): ReferenceFile {
  const random = mulberry32(SEED);
  const word = wordMaker(random);
  const header: string[] = [];
  for (let column = 0; column < columns; column += 1) {
    header.push(`Column ${column + 1}`);
  }
  const cells: (string | number)[][] = [header];
  for (let row = 1; row < rows; row += 1) {
    const line: (string | number)[] = [];
    for (let column = 0; column < columns; column += 1) {
      switch (column % 5) {
        case 0:
          line.push(row * 1000 + column);
          break;
        case 1:
          line.push(Math.round(random() * 1e8) / 100);
          break;
        case 2:
          line.push(`${word()} ${word()}`);
          break;
        case 3:
          line.push(`${word()}-${Math.floor(random() * 1e6)}`);
          break;
        default:
          line.push(`${word()} ${word()} ${word()}`);
      }
    }
    cells.push(line);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cells), 'Data');
  const written: unknown = XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
  });
  if (!(written instanceof Uint8Array)) {
    throw new Error('SheetJS wrote no buffer for the reference spreadsheet');
  }
  return {
    fileName: `reference-${rows}x${columns}.xlsx`,
    contentType: XLSX_TYPE,
    bytes: written,
    description: `spreadsheet, ${rows.toLocaleString('en-US')} rows × ${columns} columns, ${(written.length / 1e6).toFixed(1)} MB`,
  };
}

const PDF_WORDS =
  'budget memory stream process worker document index chunk vector tenant queue slot signal page table column report figure annex review'.split(
    ' ',
  );

/** The reference PDF: a text report of `pages` pages. */
export function referencePdf(pages = REFERENCE_PAGES): ReferenceFile {
  const random = mulberry32(SEED);
  const sentence = (words: number): string => {
    const picked: string[] = [];
    for (let index = 0; index < words; index += 1) {
      picked.push(PDF_WORDS[Math.floor(random() * PDF_WORDS.length)] ?? 'page');
    }
    return picked.join(' ');
  };
  const chunks: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: string | Buffer): void => {
    const buffer =
      typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    chunks.push(buffer);
    length += buffer.length;
  };
  let nextId = 1;
  const object = (body: string, stream?: Buffer): number => {
    const id = nextId;
    nextId += 1;
    offsets[id] = length;
    if (stream === undefined) {
      push(`${id} 0 obj\n${body}\nendobj\n`);
    } else {
      push(`${id} 0 obj\n${body}\nstream\n`);
      push(stream);
      push('\nendstream\nendobj\n');
    }
    return id;
  };

  push('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  // 1 is the catalog, 2 the page tree, 3 the font; the pages follow.
  nextId = 4;
  const pageIds: number[] = [];
  for (let page = 1; page <= pages; page += 1) {
    let content = 'BT /F1 10 Tf 12 TL 56 760 Td\n';
    content += `(Page ${page} of the reference report) Tj T*\n`;
    for (let line = 0; line < 44; line += 1) {
      content += `(${sentence(11)}) Tj T*\n`;
    }
    content += 'ET\n';
    const data = deflateSync(Buffer.from(content, 'latin1'));
    const contentId = object(
      `<< /Filter /FlateDecode /Length ${data.length} >>`,
      data,
    );
    pageIds.push(
      object(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  const total = nextId;
  nextId = 1;
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
  );
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const bytes = Buffer.concat(chunks);
  return {
    fileName: `reference-report-${pages}-pages.pdf`,
    contentType: 'application/pdf',
    bytes,
    description: `PDF, ${pages} pages of text, ${(bytes.length / 1e6).toFixed(1)} MB`,
  };
}

const SAMPLE_RATE = 16_000;

/** The reference recording: `seconds` of 16 kHz mono 16-bit PCM. */
export function referenceRecording(
  seconds = REFERENCE_RECORDING_SECONDS,
): ReferenceFile {
  const random = mulberry32(SEED);
  const dataBytes = seconds * SAMPLE_RATE * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVEfmt ', 8, 'latin1');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(SAMPLE_RATE, 24);
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'latin1');
  bytes.writeUInt32LE(dataBytes, 40);
  for (let second = 0; second < seconds; second += 1) {
    // Seven seconds of a voice-like tone, three of near silence, again and
    // again: what a transcription's silence stripping has to cut.
    const loud = second % 10 < 7;
    const pitch = 160 + (second % 7) * 35;
    for (let sample = 0; sample < SAMPLE_RATE; sample += 1) {
      const tone = Math.sin((sample * pitch * 2 * Math.PI) / SAMPLE_RATE);
      const value = loud
        ? Math.round(9_000 * tone + 3_000 * (random() - 0.5))
        : Math.round(20 * (random() - 0.5));
      bytes.writeInt16LE(value, 44 + (second * SAMPLE_RATE + sample) * 2);
    }
  }
  return {
    fileName: `reference-recording-${Math.round(seconds / 60)}-minutes.wav`,
    contentType: 'audio/wav',
    bytes,
    description: `recording, ${(seconds / 60).toFixed(0)} minutes of 16 kHz mono speech-like sound, ${(bytes.length / 1e6).toFixed(1)} MB`,
  };
}

/** Every reference file, made at once. */
export function referenceFiles(options: ReferenceFileOptions = {}): {
  spreadsheet: ReferenceFile;
  pdf: ReferenceFile;
  recording: ReferenceFile;
} {
  return {
    spreadsheet: referenceSpreadsheet(options.rows, options.columns),
    pdf: referencePdf(options.pages),
    recording: referenceRecording(options.recordingSeconds),
  };
}
