'use node';

/**
 * A spreadsheet read as a stream.
 *
 * SheetJS reads a workbook whole: the archive, each sheet's XML as one
 * string, and an object for every cell. A sheet of sixty thousand rows by ten
 * columns cost a process more than 300 MiB that way, for a text of ten
 * megabytes (tale-project/tale#4942). This reader goes through the archive
 * on disk a part at a time, parses each part as it inflates, keeps the shared
 * strings as bytes in a few large buffers, and hands every row to the sink
 * as soon as it is complete. The same sheet costs it about a tenth.
 *
 * It writes the text `xlsx.ts` writes: the same rows, in the same order,
 * cell for cell. SheetJS decides a number of things in ways only its own
 * parser can decide them, so this reader reads the ordinary workbook and
 * nothing else. Anything it does not recognise for certain — a part it
 * expects and does not find, a cell type it does not know, rows or cells
 * out of order, a chart sheet, a workbook with notes, a CDATA section, XML
 * the parser objects to — ends the attempt: it answers `unsupported`,
 * having written nothing, and the caller reads the file with SheetJS as
 * before. What each rule mirrors is named where it is applied (the function
 * names are those of xlsx 0.20.3).
 *
 * SheetJS finds its way through a part with patterns over its text, where
 * this reader has a parser. The two agree on XML as Excel and its kin write
 * it, and not on everything XML allows: a character written as a number
 * (`&#252;`), a line that ends in a carriage return alone, an attribute in
 * single quotes, a tag broken over two lines. A part that holds one of
 * those is left to SheetJS as well ({@link ODD_XML}), so that what a file
 * reads as never depends on which of the two read it.
 */

import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { SaxesParser } from 'saxes';
import type { Entry, ZipFile } from 'yauzl';

import { extractTextFromXlsxBytes } from '../extraction/xlsx';
import type { TextSink } from './text_sink';
import { openZipFile } from './zip_file';

/** The reader met something it leaves to SheetJS. */
class NotStreamable extends Error {
  constructor(why: string) {
    super(why);
    this.name = 'NotStreamable';
  }
}

function leave(why: string): never {
  throw new NotStreamable(why);
}

/** The sink failed, which is nobody's reason to try another reader. */
class SinkFailure extends Error {
  constructor(cause: unknown) {
    super('the text could not be written', { cause });
    this.name = 'SinkFailure';
  }
}

// ---------------------------------------------------------- SheetJS's rules

const CODE = /_x([\da-fA-F]{4})_/gi;

/** `_x000D_` and its kind, which a workbook writes for a character XML
 * cannot carry (`unescapexml`'s second replace). */
function decodeCodes(text: string): string {
  return text.includes('_x')
    ? text.replace(CODE, (_whole, code: string) =>
        String.fromCharCode(parseInt(code, 16)),
      )
    : text;
}

/** A string as a cell shows it: codes decoded, then a CR LF read as LF
 * (`unescapexml(text, true)`, after the parser has resolved the entities). */
function cellString(text: string): string {
  const decoded = decodeCodes(text);
  return decoded.includes('\r\n') ? decoded.replace(/\r\n/g, '\n') : decoded;
}

const ENTITY = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/gi;
const NAMED: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&amp;': '&',
};

/**
 * `unescapexml(text, true)` whole, entities included: a formula's string
 * value (`t="str"`) goes through it a second time in SheetJS, after the
 * pass every `<v>` gets. Kept as it is there, down to the way it reads a
 * reference it does not know.
 */
function unescapeAgain(text: string): string {
  if (text.includes('<![CDATA[')) leave('a CDATA marker in a formula string');
  const entities = text.replace(ENTITY, (whole: string, digits: string) => {
    const named = NAMED[whole];
    if (named !== undefined) return named;
    return (
      String.fromCharCode(
        parseInt(digits, whole.indexOf('x') > -1 ? 16 : 10),
      ) || whole
    );
  });
  return cellString(entities);
}

interface Range {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/** `safe_decode_range`. */
function decodeRange(range: string): Range {
  const o: Range = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } };
  let idx = 0;
  let i = 0;
  let cc = 0;
  const len = range.length;
  for (idx = 0; i < len; ++i) {
    if ((cc = range.charCodeAt(i) - 64) < 1 || cc > 26) break;
    idx = 26 * idx + cc;
  }
  o.s.c = --idx;
  for (idx = 0; i < len; ++i) {
    if ((cc = range.charCodeAt(i) - 48) < 0 || cc > 9) break;
    idx = 10 * idx + cc;
  }
  o.s.r = --idx;
  if (i === len || cc !== 10) {
    o.e.c = o.s.c;
    o.e.r = o.s.r;
    return o;
  }
  ++i;
  for (idx = 0; i !== len; ++i) {
    if ((cc = range.charCodeAt(i) - 64) < 1 || cc > 26) break;
    idx = 26 * idx + cc;
  }
  o.e.c = --idx;
  for (idx = 0; i !== len; ++i) {
    if ((cc = range.charCodeAt(i) - 48) < 0 || cc > 9) break;
    idx = 10 * idx + cc;
  }
  o.e.r = --idx;
  return o;
}

const SHEET_DATA_OPEN = /<(?:\w+:)?sheetData\b[^<>]*>/;
const DIMENSION_OPEN = /<(?:\w*:)?dimension/;
const DIMENSION_REF = /"(\w*:\w*)"/;

/**
 * The range a sheet states for itself, from what precedes its rows
 * (`parse_ws_xml`): the first double-quoted `A1:B2` within fifty characters
 * of its `<dimension`, when it is a range that runs forward. A sheet that
 * states none is as wide and as long as its cells.
 */
function statedRange(head: string): Range | null {
  const at = DIMENSION_OPEN.exec(head)?.index ?? -1;
  if (at <= 0) return null;
  const ref = DIMENSION_REF.exec(head.slice(at, at + 50));
  if (ref === null) return null;
  const range = decodeRange(ref[1] ?? '');
  return range.s.r <= range.e.r &&
    range.s.c <= range.e.c &&
    range.s.r >= 0 &&
    range.s.c >= 0
    ? range
    : null;
}

// ------------------------------------------------------------- reading parts

const localName = (name: string): string => {
  const at = name.indexOf(':');
  return at === -1 ? name : name.slice(at + 1);
};

interface XmlHandlers {
  open(
    name: string,
    attributes: Record<string, string>,
    selfClosing: boolean,
    /** The name as it is written, with its prefix where it has one. */
    written: string,
  ): void;
  close?(name: string): void;
  text?(text: string): void;
  /** True once the handlers have all they want: the rest is not read. */
  done?(): boolean;
}

function parserFor(handlers: XmlHandlers): SaxesParser {
  const parser = new SaxesParser();
  parser.on('xmldecl', (declaration) => {
    const encoding = declaration.encoding;
    if (encoding !== undefined && !/^utf-?8$/i.test(encoding)) {
      leave(`a part encoded as ${encoding}`);
    }
  });
  parser.on('opentag', (tag) =>
    handlers.open(
      localName(tag.name),
      tag.attributes,
      tag.isSelfClosing,
      tag.name,
    ),
  );
  parser.on('closetag', (tag) => handlers.close?.(localName(tag.name)));
  parser.on('text', (text) => handlers.text?.(text));
  parser.on('cdata', () => leave('a CDATA section'));
  parser.on('error', (error) =>
    leave(`XML the parser refuses: ${error.message}`),
  );
  return parser;
}

/**
 * XML that a parser and SheetJS's patterns read differently: a character
 * written as a number, which SheetJS reads as one UTF-16 unit and, in a
 * formula's string, as a byte; a carriage return that no line feed follows,
 * which a parser reads as a line end and SheetJS as itself; an attribute in
 * single quotes and a tag whose name ends its line, neither of which
 * SheetJS's patterns find.
 */
const ODD_XML = /&#|\r[^\n]|='|<[A-Za-z_][\w.:-]*[\t\n\r]/;
/** How much of the piece before is looked at again with the next: longer
 * than anything {@link ODD_XML} matches across the two. */
const ODD_XML_OVERLAP = 96;

/** A part's bytes as text, a piece at a time. A part in UTF-16, and one
 * whose XML the two readers would read differently, is left to SheetJS. */
async function* textOf(stream: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let first = true;
  let before = '';
  const checked = (text: string): string => {
    const odd = ODD_XML.exec(before + text);
    if (odd !== null) {
      leave(`XML only SheetJS reads its way (${JSON.stringify(odd[0])})`);
    }
    before = (before + text).slice(-ODD_XML_OVERLAP);
    return text;
  };
  for await (const piece of stream) {
    const chunk: Buffer = piece;
    if (first) {
      first = false;
      const a = chunk[0];
      const b = chunk[1];
      if ((a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff)) {
        leave('a part in UTF-16');
      }
    }
    const text = decoder.write(chunk);
    if (text !== '') yield checked(text);
  }
  const rest = decoder.end();
  if (rest !== '') yield checked(rest);
}

async function parsePart(
  zip: ZipFile,
  entry: Entry,
  handlers: XmlHandlers,
): Promise<void> {
  const stream = await zip.openReadStreamPromise(entry);
  const parser = parserFor(handlers);
  try {
    for await (const text of textOf(stream)) {
      parser.write(text);
      if (handlers.done?.() === true) return;
    }
    parser.close();
  } finally {
    stream.destroy();
  }
}

/** SheetJS finds a part whatever the case of its name (`safegetzipfile`). */
function findEntry(
  entries: ReadonlyMap<string, Entry>,
  name: string,
): Entry | undefined {
  const exact = entries.get(name);
  if (exact !== undefined) return exact;
  const lowered = name.toLowerCase();
  for (const [candidate, entry] of entries) {
    if (candidate.toLowerCase() === lowered) return entry;
  }
  return undefined;
}

// -------------------------------------------------------------- shared strings

/** How much of the table one buffer holds. */
const SLAB_BYTES = 1024 * 1024;

/**
 * The shared strings, as UTF-8 in a few large buffers, found by position.
 * A string per JavaScript object would cost a workbook of half a million
 * strings several times their text.
 */
class StringTable {
  private readonly slabs: Buffer[] = [];
  private used = SLAB_BYTES;
  /** Per string: its slab, its start and its end, or -1 where the item
   * holds no text. */
  private where = new Int32Array(3 * 1024);
  count = 0;

  add(text: string | undefined): void {
    if (3 * (this.count + 1) > this.where.length) {
      const grown = new Int32Array(this.where.length * 2);
      grown.set(this.where);
      this.where = grown;
    }
    const at = 3 * this.count;
    this.count += 1;
    if (text === undefined) {
      this.where[at] = -1;
      return;
    }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (this.used + bytes > SLAB_BYTES) {
      // A string longer than a slab gets one of its own.
      this.slabs.push(Buffer.allocUnsafe(Math.max(SLAB_BYTES, bytes)));
      this.used = 0;
    }
    const slab = this.slabs.length - 1;
    this.slabs[slab]?.write(text, this.used, 'utf8');
    this.where[at] = slab;
    this.where[at + 1] = this.used;
    this.where[at + 2] = this.used + bytes;
    this.used += bytes;
  }

  /** The text of item `index`; `undefined` for an item that holds none. */
  get(index: number): string | undefined {
    const at = 3 * index;
    const slab = this.where[at] ?? -1;
    if (slab === -1) return undefined;
    return this.slabs[slab]?.toString(
      'utf8',
      this.where[at + 1],
      this.where[at + 2],
    );
  }
}

/**
 * Reads the text of one `<si>` (or `<is>`) as `parse_si` does: the first
 * `<t>` when the item opens with one, else every `<t>` of its runs outside
 * a phonetic run, else nothing.
 */
class RichText {
  private first: 'unknown' | 't' | 'other' = 'unknown';
  private plain: string | undefined;
  private runs: string | undefined;
  private hasRun = false;
  private phonetic = 0;
  private inText = false;
  private depth = 0;
  private buffer = '';
  /** The item opened with an empty `<t/>`: an empty string, when nothing
   * follows it. */
  private openedEmpty = false;

  open(name: string, selfClosing: boolean): void {
    // After a leading `<t/>`, `parse_si` reads the markup that follows as
    // the string's text.
    if (this.openedEmpty) leave('a string that opens with an empty <t/>');
    this.depth += 1;
    if (this.first === 'unknown') {
      this.first = name === 't' ? 't' : 'other';
      if (name === 't' && selfClosing) this.openedEmpty = true;
    }
    if (name === 'rPh') this.phonetic += 1;
    else if (name === 'r') this.hasRun = true;
    else if (name === 't') {
      this.inText = true;
      this.buffer = '';
    }
  }

  text(text: string): void {
    if (this.inText) this.buffer += text;
  }

  close(name: string): void {
    this.depth -= 1;
    if (name === 'rPh') this.phonetic -= 1;
    else if (name === 't' && this.inText) {
      this.inText = false;
      if (this.first === 't' && this.plain === undefined && this.depth === 0) {
        this.plain = this.buffer;
      }
      if (this.phonetic === 0) this.runs = (this.runs ?? '') + this.buffer;
    }
  }

  /** The item's text, or `undefined` when it holds none SheetJS reads. */
  value(): string | undefined {
    if (this.first === 't') return cellString(this.plain ?? '');
    if (this.hasRun) return cellString(this.runs ?? '');
    return undefined;
  }
}

/** The shared strings, or `null` for a part that holds no table SheetJS
 * reads: every cell that asks it for a string then fails. */
async function readSharedStrings(
  zip: ZipFile,
  entry: Entry,
): Promise<StringTable | null> {
  const table = new StringTable();
  let item: RichText | null = null;
  let depth = 0;
  let held = false;
  await parsePart(zip, entry, {
    open(name, attributes, selfClosing) {
      depth += 1;
      if (item !== null) {
        item.open(name, selfClosing);
        return;
      }
      // `parse_sst_xml` wants an `<sst>` with a closing tag of its own.
      if (depth === 1) held = name === 'sst' && !selfClosing;
      if (depth === 2 && (name === 'si' || name === 'sstItem')) {
        // `parse_sst_xml` splits on a bare `<si>`: one that carries an
        // attribute, or closes itself, shifts every string after it.
        if (selfClosing || Object.keys(attributes).length > 0) {
          leave('a shared string item SheetJS reads its own way');
        }
        item = new RichText();
      }
    },
    text(text) {
      item?.text(text);
    },
    close(name) {
      depth -= 1;
      if (item === null) return;
      if (depth === 1 && (name === 'si' || name === 'sstItem')) {
        table.add(item.value());
        item = null;
        return;
      }
      item.close(name);
    },
  });
  return held ? table : null;
}

// ------------------------------------------------------------------- a sheet

const MAX_HEAD_CHARS = 4 * 1024 * 1024;
const CELL_REF = /^([A-Z]+)(\d+)$/;

function columnOf(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i += 1) {
    idx = 26 * idx + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * What a sheet says of itself before its rows: the range it states, and
 * whether it has rows at all. Read off the text as SheetJS reads it, so
 * that the two agree on a range written in any way.
 */
async function readSheetHead(
  zip: ZipFile,
  entry: Entry,
): Promise<{ stated: Range | null; hasRows: boolean }> {
  const stream = await zip.openReadStreamPromise(entry);
  try {
    let head = '';
    for await (const text of textOf(stream)) {
      head += text;
      const at = SHEET_DATA_OPEN.exec(head);
      if (at !== null) {
        return { stated: statedRange(head.slice(0, at.index)), hasRows: true };
      }
      if (head.length > MAX_HEAD_CHARS) leave('a sheet whose rows start late');
    }
    return { stated: statedRange(head), hasRows: false };
  } finally {
    stream.destroy();
  }
}

/** What a cell shows, or null for one that holds nothing to show. */
type Shown = string | null;

interface OpenCell {
  readonly type: string | undefined;
  readonly column: number;
  value: string | undefined;
  /** Whether SheetJS finds a formula in it (`p.f`). */
  formula: boolean;
  inline: RichText | null;
}

interface OpenFormula {
  text: string;
  readonly type: string | undefined;
  readonly shared: string | undefined;
  readonly ref: string | undefined;
}

/**
 * Go through a sheet's rows, as `parse_ws_xml_data` reads them.
 *
 * With a `range` and an `emit`, every row of the range that shows something
 * is handed over, in order, as its cells from the range's first column to
 * its last. Without them the sheet is only measured: the answer is the box
 * its rows and cells span (`refguess`), which is the range of a sheet that
 * states none.
 */
async function walkSheet(
  zip: ZipFile,
  entry: Entry,
  strings: StringTable | null,
  range: Range | null,
  emit: ((cells: string[]) => Promise<void>) | null,
): Promise<Range> {
  const guess: Range = {
    s: { r: 2_000_000, c: 2_000_000 },
    e: { r: 0, c: 0 },
  };
  const width = range === null ? 0 : range.e.c - range.s.c + 1;

  let depth = 0;
  let inSheetData = false;
  let finished = false;
  /** The row being read, counted from 1 (`tagr`). */
  let rowNumber = 0;
  let lastRow = 0;
  let rowOpen = false;
  let column = -1;
  let rowCells: Shown[] | null = null;
  let rowShows = false;
  let cell: OpenCell | null = null;
  let inValue = false;
  let valueSeen = false;
  let formula: OpenFormula | null = null;
  let inInline = false;
  /** Shared formulas that have a text, by their index (`sharedf`). */
  const sharedFormulas = new Set<number>();
  /** The ranges of the array formulas met so far (`arrayf`). */
  const arrayRanges: Range[] = [];

  const pending: Promise<void>[] = [];
  let failure: unknown;

  const endRow = (): void => {
    rowOpen = false;
    const cells = rowCells;
    rowCells = null;
    if (emit === null || cells === null || !rowShows) return;
    pending.push(
      emit(cells.map((value) => value ?? '')).catch((error: unknown) => {
        failure ??= error;
      }),
    );
  };

  const endFormula = (): void => {
    if (formula === null || cell === null) return;
    const current = formula;
    formula = null;
    // The `opts.cellFormula` block: what makes a cell without a value one
    // that holds a formula.
    if (current.text !== '') {
      cell.formula = true;
      if (current.type === 'array') {
        if (current.ref === undefined) leave('an array formula with no range');
        if (current.ref.includes(':')) {
          arrayRanges.push(decodeRange(current.ref));
        }
      } else if (current.type === 'shared' && current.shared !== undefined) {
        sharedFormulas.add(parseInt(current.shared, 10));
      }
      return;
    }
    if (
      current.type === 'shared' &&
      current.shared !== undefined &&
      sharedFormulas.has(parseInt(current.shared, 10))
    ) {
      cell.formula = true;
    }
  };

  const endCell = (): void => {
    if (cell === null) return;
    const current = cell;
    cell = null;
    const value = current.value;
    let type = current.type;

    // From "if(tag.t == null && p.v === undefined)".
    let valueless = false;
    if (type === undefined && value === undefined) {
      const row = rowNumber - 1;
      const inArray = arrayRanges.some(
        (r) =>
          row >= r.s.r &&
          row <= r.e.r &&
          current.column >= r.s.c &&
          current.column <= r.e.c,
      );
      // A cell that holds nothing is no cell: it does not widen the sheet.
      if (!current.formula && !inArray) return;
      valueless = true;
    }
    if (type === undefined || type === '') type = 'n';
    if (guess.s.c > current.column) guess.s.c = current.column;
    if (guess.e.c < current.column) guess.e.c = current.column;
    // A formula with no value kept beside it: SheetJS gives it the number
    // 0, which its next test (`p.v == ""`) reads as no value at all. The
    // cell widens the sheet and shows nothing.
    if (valueless) return;

    let shown: Shown;
    switch (type) {
      case 'n': {
        if (value === undefined || value === '') return;
        shown = parseFloat(value).toString();
        break;
      }
      case 's': {
        if (value === undefined) return;
        if (strings === null) leave('a shared string and no table');
        const index = parseInt(value, 10);
        // One past the last string reads as an empty one, which is how
        // `parse_sst_xml` leaves its table; no other index has a string.
        if (!(index >= 0 && index <= strings.count)) {
          leave('a cell that names a shared string the table lacks');
        }
        shown = index === strings.count ? '' : (strings.get(index) ?? null);
        break;
      }
      case 'str':
        shown = value === undefined ? '' : unescapeAgain(value);
        break;
      case 'inlineStr':
        shown = current.inline?.value() ?? '';
        break;
      case 'b':
        shown = value === '1' || value === 'true' ? 'true' : 'false';
        break;
      case 'e':
        // An error shows nothing, and still takes its cell.
        shown = null;
        break;
      default:
        // A date written as text (`t="d"`), or a type SheetJS throws on.
        leave(`a cell of type ${type}`);
    }

    if (rowCells === null || range === null) return;
    if (current.column < range.s.c || current.column > range.e.c) return;
    rowCells[current.column - range.s.c] = shown;
    if (shown !== null && shown.trim().length > 0) rowShows = true;
  };

  const stream = await zip.openReadStreamPromise(entry);
  const parser = parserFor({
    open(name, attributes, selfClosing) {
      depth += 1;
      if (finished) return;
      if (!inSheetData) {
        if (name === 'sheetData') {
          // SheetJS finds the rows wherever they are written; this reader
          // knows them in one place.
          if (depth !== 2) leave('rows that are not directly in the sheet');
          inSheetData = true;
        }
        return;
      }
      if (depth === 3) {
        // SheetJS finds a row wherever it is written; this reader knows
        // where a row belongs, and nothing else there.
        if (name !== 'row') leave(`<${name}> among the rows`);
        // A row that closes itself is not a row to SheetJS: it neither
        // counts nor moves the row number on.
        if (selfClosing) return;
        const given = attributes.r;
        if (given === undefined) rowNumber += 1;
        else {
          if (!/^\d+$/.test(given)) leave('a row numbered in an odd way');
          rowNumber = parseInt(given, 10);
        }
        if (rowNumber <= lastRow) leave('rows out of order');
        lastRow = rowNumber;
        rowOpen = true;
        column = -1;
        const index = rowNumber - 1;
        if (guess.s.r > index) guess.s.r = index;
        if (guess.e.r < index) guess.e.r = index;
        rowShows = false;
        rowCells =
          range !== null && index >= range.s.r && index <= range.e.r
            ? new Array<Shown>(width).fill(null)
            : null;
        return;
      }
      if (!rowOpen) return;
      if (depth === 4) {
        if (name !== 'c') leave(`<${name}> among the cells`);
        // A cell that does not say where it is: SheetJS looks for the
        // address in everything the cell holds, its text included.
        const ref = attributes.r;
        if (ref === undefined) leave('a cell with no address');
        const parts = CELL_REF.exec(ref);
        if (parts === null) leave('a cell addressed in an odd way');
        if (parseInt(parts[2] ?? '', 10) !== rowNumber) {
          leave('a cell addressed outside its row');
        }
        const at = columnOf(parts[1] ?? '');
        // Written twice, or out of order: which of two cells shows, and
        // whether its row shows at all, is SheetJS's to decide.
        if (at <= column) leave('cells out of order');
        column = at;
        cell = {
          type: attributes.t,
          column,
          value: undefined,
          formula: false,
          inline: null,
        };
        valueSeen = false;
        return;
      }
      if (cell === null) return;
      // A row or a cell inside a cell, and markup inside a value or a
      // formula: SheetJS cuts a sheet at every `<row` and `<c` it finds,
      // and reads a value as the text between its tags.
      if (name === 'row' || name === 'c') leave(`<${name}> inside a cell`);
      if (inValue || formula !== null) {
        leave(`<${name}> inside a value or a formula`);
      }
      if (inInline) {
        cell.inline?.open(name, selfClosing);
        return;
      }
      if (depth !== 5) return;
      if (name === 'v') {
        if (valueSeen) leave('a cell with two values');
        valueSeen = true;
        if (!selfClosing) {
          inValue = true;
          cell.value = '';
        }
      } else if (name === 'f' && formula === null && !cell.formula) {
        formula = {
          text: '',
          type: attributes.t,
          shared: attributes.si,
          ref: attributes.ref,
        };
      } else if (name === 'is' && cell.inline === null && !selfClosing) {
        cell.inline = new RichText();
        inInline = true;
      }
    },
    text(text) {
      if (cell === null) return;
      if (inValue) cell.value = (cell.value ?? '') + text;
      else if (formula !== null) formula.text += text;
      else if (inInline) cell.inline?.text(text);
    },
    close(name) {
      depth -= 1;
      if (finished || !inSheetData) return;
      if (depth === 1) {
        if (name === 'sheetData') finished = true;
        return;
      }
      if (depth === 2) {
        if (rowOpen) endRow();
        return;
      }
      if (cell === null) return;
      if (depth === 3) {
        endCell();
        return;
      }
      if (inInline) {
        if (depth === 4 && name === 'is') inInline = false;
        else cell.inline?.close(name);
        return;
      }
      if (depth !== 4) return;
      if (name === 'v' && inValue) {
        inValue = false;
        // An empty <v></v> is no value; one that holds text is read as
        // every <v> is (`unescapexml`, without the CR LF rule).
        cell.value =
          cell.value === '' ? undefined : decodeCodes(cell.value ?? '');
      } else if (name === 'f') {
        endFormula();
      }
    },
  });

  const settle = async (): Promise<void> => {
    if (pending.length > 0) await Promise.all(pending.splice(0));
    if (failure !== undefined) throw new SinkFailure(failure);
  };
  try {
    for await (const text of textOf(stream)) {
      parser.write(text);
      await settle();
      if (finished) break;
    }
    if (!finished) parser.close();
    await settle();
  } finally {
    stream.destroy();
  }
  return guess;
}

// --------------------------------------------------------------- the workbook

const WORKBOOK_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.ms-excel.template.macroEnabled.main+xml',
]);
const SHARED_STRINGS_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml';
const STYLES_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
/** The namespaces `parse_wb_xml` takes a workbook in (`XMLNS_main`). */
const WORKBOOK_NAMESPACES: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
  'http://schemas.microsoft.com/office/excel/2006/main',
  'http://schemas.microsoft.com/office/excel/2006/2',
]);
/** The parts by which `parse_zip` takes an archive for an OpenDocument
 * spreadsheet or a Numbers document, before it looks for a workbook. */
const OTHER_FORMATS: readonly string[] = [
  'META-INF/manifest.xml',
  'content.xml',
  'settings.xml',
  'Index/Document.iwa',
  'Index.zip',
];
const CONTENT_TYPES_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKSHEET_RELATIONS: ReadonlySet<string> = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
]);
const stripSlash = (name: string): string =>
  name.startsWith('/') ? name.slice(1) : name;

async function readWorkbook(
  zip: ZipFile,
  entries: ReadonlyMap<string, Entry>,
  sink: TextSink,
): Promise<void> {
  // An archive SheetJS takes for something other than a workbook, whatever
  // else it holds (`parse_zip`'s first questions).
  for (const other of OTHER_FORMATS) {
    if (findEntry(entries, other) !== undefined) {
      leave(`an archive that holds ${other}`);
    }
  }

  // --- [Content_Types].xml: where the workbook and its strings are
  const contentTypes = findEntry(entries, '[Content_Types].xml');
  if (contentTypes === undefined) leave('no content types');
  const workbooks: string[] = [];
  const sharedStrings: string[] = [];
  const styles: string[] = [];
  let namespace: string | undefined;
  await parsePart(zip, contentTypes, {
    open(name, attributes, _selfClosing, written) {
      // SheetJS reads these two parts by their bare names.
      if (written !== name) leave('content types written with a prefix');
      if (name === 'Types') namespace = attributes.xmlns;
      else if (name === 'Override') {
        const type = attributes.ContentType ?? '';
        const part = attributes.PartName ?? '';
        if (WORKBOOK_TYPES.has(type)) workbooks.push(part);
        else if (type === SHARED_STRINGS_TYPE) sharedStrings.push(part);
        else if (type === STYLES_TYPE) styles.push(part);
        else if (type.includes('sheet.binary')) leave('a binary workbook');
        // A note makes a cell of the place it is pinned to, and a sheet as
        // wide as its notes reach: SheetJS reads them into the sheet.
        else if (/comments\+xml$/i.test(type)) leave('a workbook with notes');
      }
    },
  });
  if (namespace !== CONTENT_TYPES_NAMESPACE)
    leave('content types in an odd namespace');

  // SheetJS reads the styles a workbook names before it reads a sheet,
  // and refuses a workbook whose styles are not there.
  const stylesName = styles[0];
  if (
    stylesName !== undefined &&
    findEntry(entries, stripSlash(stylesName)) === undefined
  ) {
    leave('styles that are named and not there');
  }

  const workbookName = stripSlash(workbooks[0] ?? 'xl/workbook.xml');
  const workbook = findEntry(entries, workbookName);
  if (workbook === undefined) leave('no workbook part');

  // --- the workbook: its sheets, in order
  const sheets: { name: string; id: string }[] = [];
  let root: string | undefined;
  await parsePart(zip, workbook, {
    open(name, attributes, _selfClosing, written) {
      if (root === undefined) {
        root = name;
        // `parse_wb_xml` refuses a workbook in a namespace it does not
        // know, and one in none.
        const colon = written.indexOf(':');
        const declared =
          attributes[
            colon === -1 ? 'xmlns' : `xmlns:${written.slice(0, colon)}`
          ];
        if (declared === undefined || !WORKBOOK_NAMESPACES.has(declared)) {
          leave('a workbook in a namespace SheetJS does not know');
        }
      }
      if (name !== 'sheet') return;
      const id = Object.entries(attributes).find(
        ([key]) => localName(key) === 'id',
      )?.[1];
      if (attributes.name === undefined || id === undefined) {
        leave('a sheet with no name or no relationship');
      }
      sheets.push({ name: decodeCodes(attributes.name), id });
    },
  });
  if (root !== 'workbook') leave('a workbook part that is not a workbook');

  // --- its relationships: which part each sheet is
  const slash = workbookName.lastIndexOf('/');
  const folder = slash === -1 ? '' : workbookName.slice(0, slash + 1);
  const relsName = `${folder}_rels/${workbookName.slice(slash + 1)}.rels`;
  const relsEntry = findEntry(entries, relsName);
  if (relsEntry === undefined) leave('no workbook relationships');
  const relationships = new Map<string, { target: string; type: string }>();
  await parsePart(zip, relsEntry, {
    open(name, attributes, _selfClosing, written) {
      if (written !== name) leave('relationships written with a prefix');
      if (name !== 'Relationship' || attributes.Id === undefined) return;
      if (attributes.TargetMode === 'External') return;
      relationships.set(attributes.Id, {
        target: attributes.Target ?? '',
        type: attributes.Type ?? '',
      });
    },
  });

  // --- the shared strings. A workbook that names no table, or one that
  // is not there, has none: a cell that then asks for a string ends the
  // attempt.
  let strings: StringTable | null = null;
  const stringsName = sharedStrings[0];
  if (stringsName !== undefined) {
    const stringsEntry = findEntry(entries, stripSlash(stringsName));
    if (stringsEntry !== undefined) {
      strings = await readSharedStrings(zip, stringsEntry);
    }
  }

  // --- the sheets
  let first = true;
  for (const sheet of sheets) {
    const relation = relationships.get(sheet.id);
    if (relation === undefined) leave('a sheet with no part');
    // A chart sheet, whose cached values SheetJS shows as a sheet of its
    // own, a dialog sheet, a macro sheet.
    if (!WORKSHEET_RELATIONS.has(relation.type)) {
      leave(`a sheet of the kind ${relation.type}`);
    }
    // The three places `parse_zip` looks for a sheet's part, in its order.
    const entry =
      findEntry(entries, `xl/${relation.target.replace(/[/]?xl\//, '')}`) ??
      findEntry(entries, relation.target) ??
      findEntry(
        entries,
        relsName.replace(/_rels\/[\S\s]*$/, '') + relation.target,
      );
    // SheetJS looks for a part in more ways than these three: whether it
    // finds this one is its to say.
    if (entry === undefined) leave('a sheet whose part is not found');

    const { stated, hasRows } = await readSheetHead(zip, entry);
    // A sheet with no rows shows nothing, whatever range it states.
    if (!hasRows) continue;
    let range = stated;
    if (range === null) {
      // It states no range of its own: it is as wide and as long as its
      // cells, which takes a pass of its own to learn.
      const guess = await walkSheet(zip, entry, strings, null, null);
      if (guess.e.c < guess.s.c || guess.e.r < guess.s.r) continue;
      range = guess;
    }

    let headed = false;
    await walkSheet(zip, entry, strings, range, async (cells) => {
      const line = cells.join(' | ').trim();
      if (line === '') return;
      let text: string;
      if (headed) text = `\n${line}`;
      else {
        headed = true;
        text = `${first ? '' : '\n\n'}--- Sheet: ${sheet.name} ---\n${line}`;
        first = false;
      }
      await sink.write(text);
    });
  }
}

/**
 * Write the text of the spreadsheet at `path` to `sink`, as `xlsx.ts` would
 * return it. `unsupported` when this reader leaves the file to SheetJS:
 * nothing is in the sink then.
 */
export async function streamXlsxText(
  path: string,
  sink: TextSink,
): Promise<'done' | 'unsupported'> {
  let opened: Awaited<ReturnType<typeof openZipFile>>;
  try {
    opened = await openZipFile(path);
  } catch (error) {
    // Not an archive this reader opens: SheetJS reads more than archives.
    console.info(
      `[extraction] a spreadsheet is read whole (${error instanceof Error ? error.message : String(error)})`,
    );
    return 'unsupported';
  }
  try {
    await readWorkbook(opened.zip, opened.entries, sink);
    return 'done';
  } catch (error) {
    if (error instanceof SinkFailure) throw error.cause;
    await sink.reset();
    console.info(
      `[extraction] a spreadsheet is read whole (${error instanceof Error ? error.message : String(error)})`,
    );
    return 'unsupported';
  } finally {
    opened.zip.close();
  }
}

/**
 * Write the text of the spreadsheet at `path` to `sink`: the text
 * `extractTextFromXlsxBytes` returns for the same file.
 *
 * An ordinary workbook is read as a stream, a row at a time. One this
 * reader leaves alone — an old binary workbook, a text file behind the
 * extension, a workbook written in a way only SheetJS reads — is read whole
 * by SheetJS, as before.
 */
export async function extractTextFromXlsxFile(
  path: string,
  sink: TextSink,
  filename = 'spreadsheet.xlsx',
): Promise<void> {
  if ((await streamXlsxText(path, sink)) === 'done') return;
  const [text] = await extractTextFromXlsxBytes(await readFile(path), filename);
  await sink.write(text);
}
