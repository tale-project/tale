// The streaming spreadsheet reader against the reader it stands in for:
// every workbook here is read both ways, and the two texts are compared. A
// workbook the streaming reader leaves alone must be left with nothing
// written, so that SheetJS's text is the only text.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { extractTextFromXlsxBytes } from '../extraction/xlsx';
import { MemoryTextSink } from './text_sink';
import { extractTextFromXlsxFile, streamXlsxText } from './xlsx_stream';

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'xlsx-stream-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function onDisk(bytes: Uint8Array): string {
  serial += 1;
  const file = path.join(dir, `book-${serial}.xlsx`);
  writeFileSync(file, bytes);
  return file;
}

/** The text SheetJS makes of the workbook, or the error it throws. */
async function bySheetJs(
  bytes: Uint8Array,
): Promise<{ text: string } | { error: string }> {
  try {
    const [text] = await extractTextFromXlsxBytes(bytes);
    return { text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read the workbook as a stream: how it ended, and what it wrote. */
async function byStream(
  bytes: Uint8Array,
): Promise<{ outcome: 'done' | 'unsupported'; text: string }> {
  const sink = new MemoryTextSink();
  const outcome = await streamXlsxText(onDisk(bytes), sink);
  return { outcome, text: sink.text() };
}

/** The workbook is read as a stream, and reads as SheetJS reads it. */
async function expectStreamed(bytes: Uint8Array): Promise<string> {
  const expected = await bySheetJs(bytes);
  const streamed = await byStream(bytes);
  expect(streamed.outcome).toBe('done');
  expect({ text: streamed.text }).toEqual(expected);
  return streamed.text;
}

/** The workbook is left to SheetJS, with nothing written. */
async function expectLeft(bytes: Uint8Array): Promise<void> {
  const streamed = await byStream(bytes);
  expect(streamed).toEqual({ outcome: 'unsupported', text: '' });
}

/**
 * The workbook is left to SheetJS, and the reader of a file answers what
 * SheetJS makes of it: its text, or the error it throws.
 */
async function expectLeftToSheetJs(bytes: Uint8Array): Promise<void> {
  await expectLeft(bytes);
  const sink = new MemoryTextSink();
  const read = await extractTextFromXlsxFile(onDisk(bytes), sink).then(
    () => ({ text: sink.text() }),
    (error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  expect(read).toEqual(await bySheetJs(bytes));
}

// ------------------------------------------------- workbooks SheetJS writes

type Cell = string | number | boolean | Date | null | XLSX.CellObject;

function written(
  sheets: Record<string, Cell[][]>,
  options: XLSX.WritingOptions = {},
): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(
    XLSX.write(book, { type: 'array', bookType: 'xlsx', ...options }),
  );
}

// ------------------------------------------------ workbooks written by hand

const CONTENT_TYPES = (sharedStrings: boolean): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
${sharedStrings ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : ''}
</Types>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** A sheet part around `body`, which is everything inside `<worksheet>`. */
const sheetOf = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}">${body}</worksheet>`;

const stringsOf = (items: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${MAIN}">${items}</sst>`;

/** A one-sheet workbook from its sheet part and, when it has one, its
 * shared strings part. `parts` replaces or adds any other part. */
async function byHand(
  sheet: string,
  sharedStrings?: string,
  parts: Record<string, string | null> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const all: Record<string, string | null> = {
    '[Content_Types].xml': CONTENT_TYPES(sharedStrings !== undefined),
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
    'xl/worksheets/sheet1.xml': sheet,
    ...(sharedStrings !== undefined
      ? { 'xl/sharedStrings.xml': sharedStrings }
      : {}),
    ...parts,
  };
  for (const [name, content] of Object.entries(all)) {
    if (content !== null) zip.file(name, content);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('a workbook SheetJS wrote reads the same as a stream', () => {
  it('reads strings, numbers and booleans, with their sheet named above them', async () => {
    const text = await expectStreamed(
      written({
        Sheet1: [
          ['name', 'count', 'done'],
          ['alpha', 3, true],
          ['beta', -0.5, false],
        ],
      }),
    );
    expect(text).toBe(
      '--- Sheet: Sheet1 ---\nname | count | done\nalpha | 3 | true\nbeta | -0.5 | false',
    );
  });

  it('reads the same with the strings in a shared table', async () => {
    await expectStreamed(
      written(
        {
          Sheet1: [
            ['name', 'name', 'other'],
            ['alpha', 'alpha', ''],
          ],
        },
        { bookSST: true },
      ),
    );
  });

  it('keeps a row its width where cells are missing, and leaves out a row that shows nothing', async () => {
    const text = await expectStreamed(
      written({
        Data: [
          ['a', 'b', 'c', 'd'],
          [null, null, null, null],
          [null, 'only b'],
          ['   ', null, null, null],
          [1, null, null, 4],
        ],
      }),
    );
    expect(text.split('\n')).toEqual([
      '--- Sheet: Data ---',
      'a | b | c | d',
      '| only b |  |',
      '1 |  |  | 4',
    ]);
  });

  it('reads several sheets in the workbook order, and skips one with nothing in it', async () => {
    const text = await expectStreamed(
      written({
        First: [['one']],
        Empty: [],
        Blank: [[null, '  ']],
        Last: [['two', 2]],
      }),
    );
    expect(text).toBe(
      '--- Sheet: First ---\none\n\n--- Sheet: Last ---\ntwo | 2',
    );
  });

  it.each([
    ['text that XML has to escape', '<a href="x">Tom & Jerry\'s</a>'],
    ['a line break inside a cell', 'first line\nsecond line'],
    ['a Windows line break inside a cell', 'first line\r\nsecond line'],
    ['a carriage return alone', 'before\rafter'],
    ['a tab', 'left\tright'],
    ['spaces at both ends', '  padded  '],
    ['a character outside the basic plane', 'grin 😀 and 𝒳'],
    ['accents and other scripts', 'Zürich, São Paulo, 東京, Ελλάδα'],
    ['a control character', 'bell\u0007here'],
    ['text that looks like an escape', 'literally _x000D_ and _x0041_'],
    ['text that looks like an entity', 'literally &amp; and &#65; and &lt;'],
    ['a pipe, which separates the cells', 'a | b'],
    ['an empty string', ''],
  ])('reads %s as SheetJS does', async (_what, value) => {
    await expectStreamed(written({ S: [['before', value, 'after']] }));
    await expectStreamed(
      written({ S: [['before', value, 'after']] }, { bookSST: true }),
    );
  });

  it.each([
    0,
    -0,
    1,
    -1,
    0.1,
    1 / 3,
    1e21,
    1.5e-7,
    123456789012345680000,
    Number.MAX_SAFE_INTEGER,
    2 ** 60,
    Number.MAX_VALUE,
    Number.MIN_VALUE,
  ])('reads the number %s as SheetJS does', async (value) => {
    await expectStreamed(written({ S: [['n', value]] }));
  });

  it('reads a date as the number SheetJS reads it as', async () => {
    await expectStreamed(
      written({ S: [['when', new Date(Date.UTC(2026, 10, 21, 12, 30))]] }),
    );
  });

  it('shows nothing for an error, and keeps its cell', async () => {
    const text = await expectStreamed(
      written({
        S: [
          ['a', { t: 'e', v: 0x2a, w: '#N/A' }, 'c'],
          [{ t: 'e', v: 0x07, w: '#DIV/0!' }, null, null],
        ],
      }),
    );
    expect(text).toBe('--- Sheet: S ---\na |  | c');
  });

  it('reads a formula by the value kept with it', async () => {
    await expectStreamed(
      written({
        S: [
          [1, 2, { t: 'n', v: 3, f: 'A1+B1' }],
          ['x', 'y', { t: 's', v: 'xy', f: 'A2&B2' }],
        ],
      }),
    );
  });

  it('reads a sheet whose name XML has to escape', async () => {
    const text = await expectStreamed(written({ 'P&L <2026>': [['x']] }));
    expect(text).toBe('--- Sheet: P&L <2026> ---\nx');
  });

  it('reads a sheet that is hidden, as SheetJS does', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['seen']]),
      'A',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['hidden']]),
      'B',
    );
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const text = await expectStreamed(
      new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })),
    );
    expect(text).toContain('--- Sheet: B ---\nhidden');
  });

  it('reads a sheet that starts away from its first cell', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // The same cells, three columns right and four rows down.
    const moved: XLSX.WorkSheet = { '!ref': 'D5:E6' };
    moved.D5 = sheet.A1;
    moved.E5 = sheet.B1;
    moved.D6 = sheet.A2;
    moved.E6 = sheet.B2;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, moved, 'Moved');
    const text = await expectStreamed(
      new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })),
    );
    expect(text).toBe('--- Sheet: Moved ---\na | b\nc | d');
  });

  it('reads a workbook saved with macros', async () => {
    await expectStreamed(
      new Uint8Array(
        XLSX.write(
          (() => {
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(
              book,
              XLSX.utils.aoa_to_sheet([['macro', 1]]),
              'M',
            );
            return book;
          })(),
          { type: 'array', bookType: 'xlsm' },
        ),
      ),
    );
  });

  it('reads many rows, more than one piece of the part at a time', async () => {
    const rows: Cell[][] = [];
    for (let r = 0; r < 5000; r += 1) {
      rows.push([r, `row ${r}`, r % 2 === 0, `tail ${r * 7}`]);
    }
    const text = await expectStreamed(written({ Big: rows }));
    expect(text.split('\n')).toHaveLength(5001);
    await expectStreamed(written({ Big: rows }, { bookSST: true }));
  });

  it('reads many distinct strings from a shared table', async () => {
    const rows: Cell[][] = [];
    for (let r = 0; r < 4000; r += 1) {
      rows.push([`a-${r}`, `b-${r}-${'x'.repeat(r % 40)}`, `ç-${r}`]);
    }
    await expectStreamed(written({ Strings: rows }, { bookSST: true }));
  });

  // Written by hand: SheetJS reads a string of any length and writes none
  // over 32,767 characters.
  it('reads a string longer than one buffer of the table holds', async () => {
    const long = 'long '.repeat(300_000);
    const text = await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row></sheetData>',
        ),
        stringsOf(
          `<si><t>before</t></si><si><t>${long}</t></si><si><t>after</t></si>`,
        ),
      ),
    );
    expect(text).toHaveLength(
      '--- Sheet: Data ---\nbefore |  | after'.length + long.length,
    );
  });
});

describe('workbooks at random read the same as a stream', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STRINGS = [
    '',
    ' ',
    'plain',
    'two words',
    ' lead',
    'trail ',
    'a\nb',
    'a\r\nb',
    '<&>"\'',
    '_x0041_',
    'Ünï',
    '😀',
    '0',
    'true',
    '1e5',
    '|',
  ];

  function randomCell(random: () => number): Cell {
    const kind = random();
    if (kind < 0.3) return null;
    if (kind < 0.6) return STRINGS[Math.floor(random() * STRINGS.length)] ?? '';
    if (kind < 0.8) return Math.round((random() - 0.5) * 1e6) / 1000;
    if (kind < 0.9) return random() < 0.5;
    if (kind < 0.95) return { t: 'e', v: 0x2a, w: '#N/A' };
    return { t: 'n', v: Math.floor(random() * 100), f: 'A1*2' };
  }

  it.each(Array.from({ length: 60 }, (_unused, seed) => seed))(
    'seed %i',
    async (seed) => {
      const random = mulberry32(seed + 1);
      const sheets: Record<string, Cell[][]> = {};
      const sheetCount = 1 + Math.floor(random() * 3);
      for (let s = 0; s < sheetCount; s += 1) {
        const rows: Cell[][] = [];
        const rowCount = Math.floor(random() * 14);
        const width = 1 + Math.floor(random() * 7);
        for (let r = 0; r < rowCount; r += 1) {
          const row: Cell[] = [];
          const cells = Math.floor(random() * (width + 1));
          for (let c = 0; c < cells; c += 1) row.push(randomCell(random));
          rows.push(row);
        }
        sheets[`Sheet ${s + 1}`] = rows;
      }
      await expectStreamed(
        written(sheets, { bookSST: random() < 0.5, compression: true }),
      );
    },
  );
});

describe('a workbook written by hand reads the same as a stream', () => {
  it('numbers the rows that carry no number', async () => {
    const text = await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row><c r="A2" t="b"><v>1</v></c></row><row r="5"><c r="A5"><v>5</v></c><c r="C5"><v>7</v></c><c r="D5"><v>8</v></c></row><row><c r="A6"><v>6</v></c></row></sheetData>',
        ),
      ),
    );
    expect(text.split('\n')).toEqual([
      '--- Sheet: Data ---',
      '1 | 2 |  |',
      'true |  |  |',
      '5 |  | 7 | 8',
      '6 |  |  |',
    ]);
  });

  it.each([
    ['a range that is the size of its cells', 'A1:B2'],
    ['a range narrower and shorter than its cells', 'A1:A1'],
    ['a range that starts after its first cells', 'B2:C3'],
    ['a range wider and longer than its cells', 'A1:E9'],
  ])('keeps to %s', async (_what, ref) => {
    await expectStreamed(
      await byHand(
        sheetOf(
          `<dimension ref="${ref}"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row><row r="2"><c r="A2"><v>4</v></c><c r="B2"><v>5</v></c></row><row r="3"><c r="C3"><v>9</v></c></row></sheetData>`,
        ),
      ),
    );
  });

  it.each([
    ['one cell, which is no range', '<dimension ref="A1"/>'],
    ['a range that runs backwards', '<dimension ref="C3:A1"/>'],
    ['a range of absolute addresses', '<dimension ref="$A$1:$A$1"/>'],
    [
      'a range that comes late in its tag',
      `<dimension ${'x'.repeat(40)}="1" ref="A1:A1"/>`,
    ],
  ])('measures the sheet where it states %s', async (_what, dimension) => {
    await expectStreamed(
      await byHand(
        sheetOf(
          `${dimension}<sheetData><row r="2"><c r="B2"><v>1</v></c><c r="D2"><v>2</v></c></row><row r="4"><c r="C4"><v>3</v></c></row></sheetData>`,
        ),
      ),
    );
  });

  it('reads a range stated on a tag with a prefix', async () => {
    await expectStreamed(
      await byHand(
        `<?xml version="1.0" encoding="UTF-8"?>\n<x:worksheet xmlns:x="${MAIN}"><x:dimension ref="A1:B1"/><x:sheetData><x:row r="1"><x:c r="A1"><x:v>1</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>in</x:t></x:is></x:c><x:c r="C1"><x:v>3</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
      ),
    );
  });

  it('reads strings written in place, plain and in runs', async () => {
    const text = await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1">' +
            '<c r="A1" t="inlineStr"><is><t>plain</t></is></c>' +
            '<c r="B1" t="inlineStr"><is><r><rPr><b/></rPr><t>bold</t></r><r><t xml:space="preserve"> and thin</t></r></is></c>' +
            '<c r="C1" t="inlineStr"><is><t>read</t><rPh sb="0" eb="1"><t>NOT READ</t></rPh></is></c>' +
            '<c r="D1" t="inlineStr"><is><r><t>run</t></r><rPh sb="0" eb="1"><t>NOT READ</t></rPh></is></c>' +
            '<c r="E1" t="inlineStr"><is/></c>' +
            '<c r="F1" t="inlineStr"></c>' +
            '<c r="G1" t="inlineStr"><is><t/></is></c>' +
            '<c r="H1"><v>1</v></c>' +
            '</row></sheetData>',
        ),
      ),
    );
    expect(text).toBe(
      '--- Sheet: Data ---\nplain | bold and thin | read | run |  |  |  | 1',
    );
  });

  it('reads shared strings, plain, in runs, empty and with none', async () => {
    const text = await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1">' +
            [0, 1, 2, 3, 4, 5]
              .map(
                (index, column) =>
                  `<c r="${'ABCDEF'[column]}1" t="s"><v>${index}</v></c>`,
              )
              .join('') +
            '<c r="G1"><v>7</v></c></row></sheetData>',
        ),
        stringsOf(
          '<si><t>plain</t></si>' +
            '<si><r><t>one</t></r><r><rPr><i/></rPr><t xml:space="preserve"> two</t></r></si>' +
            '<si><t/></si>' +
            '<si><t>read</t><rPh sb="0" eb="1"><t>NOT READ</t></rPh><phoneticPr fontId="1"/></si>' +
            '<si></si>' +
            '<si><t>line_x000D_\nbreak &amp; _x0041_</t></si>',
        ),
      ),
    );
    expect(text).toBe(
      '--- Sheet: Data ---\nplain | one two |  | read |  | line\nbreak & A | 7',
    );
  });

  it('reads the string one past the table as an empty one', async () => {
    await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>1</v></c></row></sheetData>',
        ),
        stringsOf('<si><t>only</t></si>'),
      ),
    );
  });

  it.each([
    ['a formula and no value', '<c r="B1"><f>A1*2</f></c>'],
    [
      'a formula shared from another cell and no value',
      '<c r="B1"><f t="shared" ref="B1:B2" si="0">A1*2</f></c><c r="C1"><f t="shared" si="0"/></c>',
    ],
    [
      'a shared formula that was never given',
      '<c r="B1"><f t="shared" si="4"/></c>',
    ],
    [
      'an array formula over cells with no value',
      '<c r="B1"><f t="array" ref="B1:D1">A1:A3</f></c><c r="C1"/><c r="D1" s="1"/><c r="E1"/>',
    ],
    ['a formula with an empty text', '<c r="B1"><f></f></c>'],
    ['a formula and an empty value', '<c r="B1"><f>A1</f><v></v></c>'],
    ['a formula and its value', '<c r="B1"><f>A1</f><v>4</v></c>'],
  ])('reads a cell with %s', async (_what, cells) => {
    await expectStreamed(
      await byHand(
        sheetOf(
          `<sheetData><row r="1"><c r="A1"><v>2</v></c>${cells}<c r="F1"><v>9</v></c></row></sheetData>`,
        ),
      ),
    );
  });

  it.each([
    ['a formula string', '<c r="A1" t="str"><v>made &amp;amp; unmade</v></c>'],
    ['a formula string with no value', '<c r="A1" t="str"></c>'],
    [
      'a formula string that escapes an underscore',
      '<c r="A1" t="str"><v>_x005F_x0041_ and _x0042_</v></c>',
    ],
    ['a number written with an exponent', '<c r="A1"><v>1.5E-3</v></c>'],
    ['a number with text after it', '<c r="A1"><v>12abc</v></c>'],
    ['a number that is no number', '<c r="A1"><v>abc</v></c>'],
    ['a number of spaces', '<c r="A1"><v> </v></c>'],
    ['an empty value', '<c r="A1"><v></v></c>'],
    ['a value written as an empty tag', '<c r="A1"><v/></c>'],
    ['a type that is empty', '<c r="A1" t=""><v>3</v></c>'],
    ['a boolean written as a word', '<c r="A1" t="b"><v>true</v></c>'],
    ['a boolean that is neither', '<c r="A1" t="b"><v>yes</v></c>'],
    ['a boolean with no value', '<c r="A1" t="b"/>'],
    ['an error', '<c r="A1" t="e"><v>#DIV/0!</v></c>'],
    ['an error with no value', '<c r="A1" t="e"/>'],
    ['a cell with only a style', '<c r="A1" s="3"/>'],
  ])('reads %s', async (_what, cells) => {
    await expectStreamed(
      await byHand(
        sheetOf(
          `<sheetData><row r="1">${cells}<c r="D1"><v>4</v></c></row></sheetData>`,
        ),
      ),
    );
  });

  it('does not count a row that closes itself', async () => {
    await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row/><row r="7"/><row><c r="A2"><v>2</v></c></row></sheetData>',
        ),
      ),
    );
  });

  it('reads a sheet with rows declared and none written', async () => {
    await expectStreamed(
      await byHand(sheetOf('<dimension ref="A1:C3"/><sheetData/>')),
    );
    await expectStreamed(
      await byHand(sheetOf('<dimension ref="A1:C3"/><sheetData></sheetData>')),
    );
    await expectStreamed(await byHand(sheetOf('<dimension ref="A1:C3"/>')));
  });

  it('finds a sheet whose part is named from the archive root', async () => {
    await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>',
        ),
        undefined,
        {
          'xl/_rels/workbook.xml.rels': WORKBOOK_RELS.replace(
            'Target="worksheets/sheet1.xml"',
            'Target="/xl/worksheets/sheet1.xml"',
          ),
        },
      ),
    );
  });

  it('stops reading a sheet where its rows end', async () => {
    await expectStreamed(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells><extLst><ext><row r="9"><c r="A9"><v>9</v></c></row></ext></extLst>',
        ),
      ),
    );
  });
});

describe('a workbook the streaming reader leaves to SheetJS', () => {
  const ONE_ROW =
    '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>';

  it.each([
    [
      'a date written as text',
      sheetOf(
        '<sheetData><row r="1"><c r="A1" t="d"><v>2026-11-21T00:00:00Z</v></c></row></sheetData>',
      ),
    ],
    [
      'a cell type it does not know',
      sheetOf(
        '<sheetData><row r="1"><c r="A1" t="x"><v>1</v></c></row></sheetData>',
      ),
    ],
    [
      'rows out of order',
      sheetOf(
        '<sheetData><row r="2"><c r="A2"><v>2</v></c></row><row r="1"><c r="A1"><v>1</v></c></row></sheetData>',
      ),
    ],
    [
      'a row written twice',
      sheetOf(
        '<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="1"><c r="B1"><v>2</v></c></row></sheetData>',
      ),
    ],
    [
      'a cell addressed outside its row',
      sheetOf('<sheetData><row r="1"><c r="A3"><v>1</v></c></row></sheetData>'),
    ],
    [
      'a cell addressed in lower case',
      sheetOf('<sheetData><row r="1"><c r="a1"><v>1</v></c></row></sheetData>'),
    ],
    [
      'a CDATA section',
      sheetOf(
        '<sheetData><row r="1"><c r="A1" t="str"><v><![CDATA[a<b]]></v></c></row></sheetData>',
      ),
    ],
    [
      'something that is no row among the rows',
      sheetOf(`<sheetData><group>${ONE_ROW}</group></sheetData>`),
    ],
    [
      'something that is no cell among the cells',
      sheetOf(
        '<sheetData><row r="1"><c r="A1"><v>1</v></c><extLst/></row></sheetData>',
      ),
    ],
    [
      'an array formula with no range',
      sheetOf(
        '<sheetData><row r="1"><c r="A1"><f t="array">A2:A3</f></c></row></sheetData>',
      ),
    ],
    [
      'XML that is not well formed',
      sheetOf('<sheetData><row r="1"><c r="A1"><v>1</v></row></sheetData>'),
    ],
    [
      'an entity XML does not define',
      sheetOf(
        '<sheetData><row r="1"><c r="A1" t="str"><v>a&nbsp;b</v></c></row></sheetData>',
      ),
    ],
  ])('leaves %s', async (_what, sheet) => {
    await expectLeft(await byHand(sheet));
  });

  it('leaves a cell that names a shared string where there is no table', async () => {
    await expectLeft(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>',
        ),
      ),
    );
  });

  it.each([
    ['a string the table lacks', '<si><t>only</t></si>', 2],
    ['a string numbered below zero', '<si><t>only</t></si>', -1],
  ])('leaves a cell that names %s', async (_what, items, index) => {
    await expectLeft(
      await byHand(
        sheetOf(
          `<sheetData><row r="1"><c r="A1" t="s"><v>${index}</v></c></row></sheetData>`,
        ),
        stringsOf(items),
      ),
    );
  });

  it.each([
    [
      'an item that carries an attribute',
      '<si xml:space="preserve"><t>a</t></si>',
    ],
    ['an item that closes itself', '<si/><si><t>a</t></si>'],
    ['an item with markup after an empty text', '<si><t/><r><t>a</t></r></si>'],
  ])('leaves a table with %s', async (_what, items) => {
    await expectLeft(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>',
        ),
        stringsOf(items),
      ),
    );
  });

  it('leaves a table that is a single empty tag', async () => {
    await expectLeft(
      await byHand(
        sheetOf(
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>',
        ),
        `<?xml version="1.0"?><sst xmlns="${MAIN}"/>`,
      ),
    );
  });

  it('leaves a second sheet it cannot read, with the first one unwritten', async () => {
    const bytes = await byHand(sheetOf(ONE_ROW), undefined, {
      'xl/workbook.xml': WORKBOOK.replace(
        '</sheets>',
        '<sheet name="Second" sheetId="2" r:id="rId5"/></sheets>',
      ),
      'xl/_rels/workbook.xml.rels': WORKBOOK_RELS.replace(
        '</Relationships>',
        '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet2.xml': sheetOf(
        '<dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2" t="d"><v>2026-11-21</v></c></row></sheetData>',
      ),
    });
    await expectLeft(bytes);
  });

  it.each([
    ['no content types', { '[Content_Types].xml': null }],
    ['no workbook part', { 'xl/workbook.xml': null }],
    ['no workbook relationships', { 'xl/_rels/workbook.xml.rels': null }],
    [
      'a sheet of another kind',
      {
        'xl/_rels/workbook.xml.rels': WORKBOOK_RELS.replace(
          'relationships/worksheet',
          'relationships/dialogsheet',
        ),
      },
    ],
    [
      'a part in another encoding',
      {
        'xl/worksheets/sheet1.xml': sheetOf(ONE_ROW).replace(
          'UTF-8',
          'ISO-8859-1',
        ),
      },
    ],
  ])('leaves a workbook with %s', async (_what, parts) => {
    await expectLeft(await byHand(sheetOf(ONE_ROW), undefined, parts));
  });

  it.each([
    ['nothing at all', new Uint8Array()],
    ['text', new TextEncoder().encode('a,b\n1,2\n')],
    ['an archive that is no workbook', null],
  ])('leaves a file that holds %s', async (_what, bytes) => {
    const zip = new JSZip();
    zip.file('readme.txt', 'not a workbook');
    await expectLeft(
      bytes ?? (await zip.generateAsync({ type: 'uint8array' })),
    );
  });
});

describe('extractTextFromXlsxFile', () => {
  it('writes what the streaming reader reads', async () => {
    const bytes = written({ S: [['a', 1]] });
    const sink = new MemoryTextSink();
    await extractTextFromXlsxFile(onDisk(bytes), sink);
    expect(sink.text()).toBe('--- Sheet: S ---\na | 1');
  });

  it('writes what SheetJS reads of a workbook the streaming reader leaves', async () => {
    const bytes = await byHand(
      sheetOf(
        '<sheetData><row r="2"><c r="A2"><v>2</v></c></row><row r="1"><c r="A1"><v>1</v></c></row></sheetData>',
      ),
    );
    const sink = new MemoryTextSink();
    await extractTextFromXlsxFile(onDisk(bytes), sink);
    expect(sink.text()).toBe('--- Sheet: Data ---\n1\n2');
  });

  it('writes what SheetJS reads of text behind the extension', async () => {
    const sink = new MemoryTextSink();
    await extractTextFromXlsxFile(
      onDisk(new TextEncoder().encode('a,b\n1,2\n')),
      sink,
    );
    expect(sink.text()).toBe('--- Sheet: Sheet1 ---\na | b\n1 | 2');
  });

  it('writes nothing for an empty file, as before', async () => {
    const sink = new MemoryTextSink();
    await extractTextFromXlsxFile(onDisk(new Uint8Array()), sink);
    expect(sink.text()).toBe('');
  });
});

// SheetJS finds its way through a workbook with patterns over its text, and
// decides a number of things as only those patterns can. Where a workbook is
// written in a way the two readers would read differently, the streaming
// reader must not read it at all: what a file reads as may not depend on
// which reader read it.
describe('a workbook the two readers would read differently', () => {
  const row = (cells: string): string =>
    sheetOf(
      `<sheetData><row r="1">${cells}<c r="D1"><v>4</v></c></row></sheetData>`,
    );
  const SHEET = sheetOf(
    '<dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>count</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>alpha</t></is></c><c r="B2"><v>3</v></c></row></sheetData>',
  );

  it.each([
    ['a cell with no address', '<c><v>1</v></c>'],
    [
      'a cell with no address whose text looks like one',
      '<c t="inlineStr"><is><t>see r="B7" below</t></is></c>',
    ],
    ['the same cell twice', '<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>'],
    [
      'the same cell twice, the second with nothing in it',
      '<c r="A1"><v>1</v></c><c r="A1"/>',
    ],
    [
      'the same cell twice, the second an error',
      '<c r="A1"><v>1</v></c><c r="A1" t="e"><v>#N/A</v></c>',
    ],
    [
      'a cell written twice and nothing else, the second an error',
      '<c r="B1"><v>1</v></c><c r="B1" t="e"><v>#N/A</v></c>',
    ],
    ['cells in no order', '<c r="C1"><v>3</v></c><c r="A1"><v>1</v></c>'],
    ['two values in one cell', '<c r="A1"><v>1</v><v>2</v></c>'],
    ['an empty value and then a value', '<c r="A1"><v/><v>2</v></c>'],
    ['a cell inside a value', '<c r="A1"><v>1<c r="B1"><v>2</v></c></v></c>'],
    [
      'a row inside a string written in place',
      '<c r="A1" t="inlineStr"><is><t>a</t><row r="9"><c r="A9"><v>9</v></c></row></is></c>',
    ],
    ['markup inside a formula', '<c r="A1"><f>SUM(<x/>B1)</f><v>1</v></c>'],
    [
      'a character written as a number',
      '<c r="A1" t="inlineStr"><is><t>Z&#252;rich</t></is></c>',
    ],
    [
      'a character outside the basic plane written as a number',
      '<c r="A1" t="inlineStr"><is><t>&#128512;</t></is></c>',
    ],
    [
      'a character written as a number in a formula string',
      '<c r="A1" t="str"><v>Z&#252;rich</v></c>',
    ],
    [
      'a carriage return on its own',
      '<c r="A1" t="inlineStr"><is><t>one\rtwo</t></is></c>',
    ],
    ['a tag whose name ends its line', '<c\n r="A1"><v>1</v></c>'],
    ['an attribute in single quotes', "<c r='A1'><v>1</v></c>"],
  ])('leaves a sheet with %s to SheetJS', async (_what, cells) => {
    await expectLeftToSheetJs(await byHand(row(cells)));
  });

  it('leaves a sheet that states its range in single quotes to SheetJS', async () => {
    await expectLeftToSheetJs(
      await byHand(
        sheetOf(
          '<dimension ref=\'A1:A1\'/><sheetData><row r="2"><c r="B2"><v>1</v></c></row></sheetData>',
        ),
      ),
    );
  });

  it('leaves a sheet whose rows are not directly in it to SheetJS', async () => {
    await expectLeftToSheetJs(
      await byHand(
        sheetOf(
          '<extLst><ext><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></ext></extLst>',
        ),
      ),
    );
  });

  it('leaves a workbook with a chart sheet to SheetJS', async () => {
    await expectLeftToSheetJs(
      await byHand(SHEET, undefined, {
        'xl/workbook.xml': WORKBOOK.replace(
          '</sheets>',
          '<sheet name="Chart" sheetId="2" r:id="rId3"/></sheets>',
        ),
        'xl/_rels/workbook.xml.rels': WORKBOOK_RELS.replace(
          '</Relationships>',
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>',
        ),
        'xl/chartsheets/sheet1.xml': `<?xml version="1.0"?><chartsheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>`,
      }),
    );
  });

  it.each([
    ['is not there', 'worksheets/sheet9.xml'],
    ['is named with a backslash', 'worksheets\\sheet1.xml'],
    ['is named with a doubled slash', 'worksheets//sheet1.xml'],
  ])(
    "leaves a workbook to SheetJS when a sheet's part %s",
    async (_what, target) => {
      await expectLeftToSheetJs(
        await byHand(SHEET, undefined, {
          'xl/_rels/workbook.xml.rels': WORKBOOK_RELS.replace(
            'Target="worksheets/sheet1.xml"',
            `Target="${target}"`,
          ),
        }),
      );
    },
  );

  it('leaves a workbook whose relationships carry a prefix to SheetJS', async () => {
    await expectLeftToSheetJs(
      await byHand(SHEET, undefined, {
        'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><ns0:Relationships xmlns:ns0="http://schemas.openxmlformats.org/package/2006/relationships"><ns0:Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></ns0:Relationships>`,
      }),
    );
  });

  // A note makes a cell of the place it is pinned to: SheetJS widens the
  // sheet to it, and every row with it.
  it.each([
    ["inside the sheet's range", 'A2'],
    ["right of the sheet's range", 'D1'],
    ["below the sheet's range", 'A9'],
  ])('leaves a workbook with a note %s to SheetJS', async (_what, ref) => {
    await expectLeftToSheetJs(
      await byHand(SHEET, undefined, {
        '[Content_Types].xml': CONTENT_TYPES(false).replace(
          '</Types>',
          '<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/></Types>',
        ),
        'xl/worksheets/_rels/sheet1.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>`,
        'xl/comments1.xml': `<?xml version="1.0"?><comments xmlns="${MAIN}"><authors><author>A</author></authors><commentList><comment ref="${ref}" authorId="0"><text><t>a note</t></text></comment></commentList></comments>`,
      }),
    );
  });

  // What SheetJS refuses, or takes for another kind of document, is its to
  // refuse: a file that could not be read must not become readable by the
  // way it happens to be read.
  it.each([
    [
      'the workbook is in no namespace',
      { 'xl/workbook.xml': WORKBOOK.replace(` xmlns="${MAIN}"`, '') },
    ],
    [
      'the workbook is in a namespace of its own',
      { 'xl/workbook.xml': WORKBOOK.replace(MAIN, 'urn:example:workbook') },
    ],
    [
      'it holds an OpenDocument manifest',
      { 'META-INF/manifest.xml': '<?xml version="1.0"?><manifest/>' },
    ],
    [
      'it names styles that are not there',
      {
        '[Content_Types].xml': CONTENT_TYPES(false).replace(
          '</Types>',
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        ),
      },
    ],
  ])('leaves a workbook to SheetJS when %s', async (_what, parts) => {
    await expectLeftToSheetJs(await byHand(SHEET, undefined, parts));
  });

  it('reads as a stream a workbook whose tags carry a prefix, in the namespace it should be in', async () => {
    await expectStreamed(
      await byHand(SHEET, undefined, {
        'xl/workbook.xml': `<?xml version="1.0"?><x:workbook xmlns:x="${MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Data" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
      }),
    );
  });

  it('reads as a stream the same sheet written plainly', async () => {
    const text = await expectStreamed(await byHand(SHEET));
    expect(text).toBe('--- Sheet: Data ---\nname | count\nalpha | 3');
  });
});
