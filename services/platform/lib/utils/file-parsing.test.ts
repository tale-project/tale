import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

import {
  excelRecords,
  excelHeaderText,
  parseImportFile,
  parseCSVWithMapper,
  type RequiredColumn,
} from './file-parsing';

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  private listeners = new Map<string, ((event: Event) => void)[]>();

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  readAsArrayBuffer(file: Blob) {
    void file.arrayBuffer().then((result) => {
      this.result = result;
      this.listeners
        .get('load')
        ?.forEach((listener) => listener({ target: this } as unknown as Event));
    });
  }
}

// parseImportFile uses the browser FileReader API; this small adapter exercises
// the same byte path in the server test environment.
vi.stubGlobal('FileReader', TestFileReader);

type Row = { email: string; name?: string };

// A record mapper that accepts a couple of header aliases for email/name.
const recordMapper = (record: Record<string, unknown>): Row | null => {
  const email = (record.email as string) || (record['email address'] as string);
  if (!email) return null;
  const name = (record.name as string) || (record.company as string);
  return { email, name: name || undefined };
};

const requiredColumns: RequiredColumn[] = [
  { label: 'email', aliases: ['email', 'e-mail', 'email address'] },
];

describe('parseCSVWithMapper required-column validation (#1312, #1323)', () => {
  it('maps rows when the required column is present', () => {
    const csv = 'email,name\nuser@example.com,Acme';
    const result = parseCSVWithMapper(csv, () => null, {
      recordMapper,
      requiredColumns,
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual([{ email: 'user@example.com', name: 'Acme' }]);
  });

  it('maps rows when the required column is present under an alias', () => {
    const csv = 'Email Address,Company\nuser@example.com,Acme';
    const result = parseCSVWithMapper(csv, () => null, {
      recordMapper,
      requiredColumns,
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual([{ email: 'user@example.com', name: 'Acme' }]);
  });

  it('fails loudly (no partial import) when the required column is absent', () => {
    // "name,locale" has no email-like column — previously this silently
    // dropped every row; now it returns a clear error and imports nothing.
    const csv = 'name,locale\nAcme,en';
    const result = parseCSVWithMapper(csv, () => null, {
      recordMapper,
      requiredColumns,
    });
    expect(result.data).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Missing required column(s): email');
  });

  it('does not validate when no required columns are configured', () => {
    const csv = 'name\nAcme';
    const result = parseCSVWithMapper(csv, () => null, { recordMapper });
    // No email column, recordMapper returns null for the row -> dropped,
    // but no header error because validation was not requested.
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual([]);
  });
});

describe('parseCSVWithMapper quoted fields (RFC 4180, #3580)', () => {
  // Keeps every cell as read, so a test sees exactly what the parser split.
  const parse = (csv: string) =>
    parseCSVWithMapper(csv, () => null, {
      recordMapper: (record) => record,
    });

  it("reads a spreadsheet's multi-line cell as one record", () => {
    // What a spreadsheet's CSV export writes for a cell holding a line
    // break: one quoted field across two physical lines.
    const csv = XLSX.utils.sheet_to_csv(
      XLSX.utils.aoa_to_sheet([
        ['name', 'description', 'price', 'stock'],
        ['Widget', 'First line\nSecond line', 12, 3],
      ]),
    );
    expect(csv).toBe(
      'name,description,price,stock\nWidget,"First line\nSecond line",12,3',
    );
    const result = parse(csv);
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.data).toEqual([
      {
        name: 'Widget',
        description: 'First line\nSecond line',
        price: '12',
        stock: '3',
      },
    ]);
    expect(result.rows).toEqual([2]);
  });

  it('keeps commas, escaped quotes and CRLF line breaks inside quoted cells', () => {
    const csv = XLSX.utils.sheet_to_csv(
      XLSX.utils.aoa_to_sheet([
        ['name', 'description', 'price', 'stock'],
        ['Kettle, steel', 'Says "hi", twice\r\nand again', 10, 1],
        ['Mixer', '', 5, 2],
      ]),
      { RS: '\r\n' },
    );
    const result = parse(csv);
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.data).toEqual([
      {
        name: 'Kettle, steel',
        description: 'Says "hi", twice\r\nand again',
        price: '10',
        stock: '1',
      },
      { name: 'Mixer', description: '', price: '5', stock: '2' },
    ]);
    // A multi-line cell is one spreadsheet row, so Mixer is still row 3.
    expect(result.rows).toEqual([2, 3]);
  });

  it('reads records across lines without a header row too', () => {
    const result = parseCSVWithMapper('a,"b\nc"\nd,e', (row) => row);
    expect(result.data).toEqual([
      ['a', 'b\nc'],
      ['d', 'e'],
    ]);
  });

  it('reads plain rows and one-line quoted commas as before', () => {
    // Blank lines around the header and between rows are still skipped.
    const result = parse(
      '\r\n \r\nname,price,stock\r\nWidget,9.99,100\r\n\r\n "Gadget, large" ,5,0\r\n\r\n',
    );
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual([
      { name: 'Widget', price: '9.99', stock: '100' },
      { name: 'Gadget, large', price: '5', stock: '0' },
    ]);
  });

  it('reads a quote inside an unquoted cell as a literal character', () => {
    // Only a quote that opens a cell starts a quoted field; the inch mark
    // must not run on into the next record.
    const result = parse(
      'name,description,price,stock\nCable,6" long,5,10\nPlug,"x",1,1',
    );
    expect(result.data).toEqual([
      { name: 'Cable', description: '6" long', price: '5', stock: '10' },
      { name: 'Plug', description: 'x', price: '1', stock: '1' },
    ]);
  });

  it('refuses a row whose quote never closes, and keeps the rows after it', () => {
    // An unbalanced quote must neither swallow the rows after it nor import
    // its own row misread.
    const result = parse(
      'name,description,price,stock\nWidget,"Best widget,12,3\nGadget,x,5,1',
    );
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([{ row: 2, quotes: 'unpaired' }]);
    expect(result.data).toEqual([
      { name: 'Gadget', description: 'x', price: '5', stock: '1' },
    ]);
    expect(result.rows).toEqual([3]);
  });

  it('refuses a row with text after a closing quote', () => {
    const result = parse(
      [
        'name,description,price,stock',
        'Widget,"Best" widget,12,3',
        // Two stray quotes pair up across lines and merge two rows.
        'Cable,"thin,1,1',
        'Plug,"x" y,2,2',
        'Gadget,x,5,1',
      ].join('\n'),
    );
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([
      { row: 2, quotes: 'unpaired' },
      { row: 3, quotes: 'unpaired' },
    ]);
    expect(result.data).toEqual([
      { name: 'Gadget', description: 'x', price: '5', stock: '1' },
    ]);
  });

  it('refuses the file at line 1 when the header quotes do not pair up', () => {
    const result = parse('name,"description,price,stock\nWidget,x,12,3');
    expect(result.data).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rowErrors).toEqual([{ row: 1, quotes: 'unpaired' }]);
  });
});

describe('excelRecords line numbers', () => {
  it('reports the spreadsheet line of each record, blank rows included', () => {
    // Line 1 is the header; line 3 is blank and SheetJS skips it, so the
    // record on line 4 used to be reported as line 3.
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Email', 'Name'],
      ['a@example.test', 'A'],
      [],
      ['b@example.test', 'B'],
      [],
      [],
      ['c@example.test', 'C'],
    ]);
    expect(excelRecords(XLSX, sheet)).toEqual([
      { record: { email: 'a@example.test', name: 'A' }, line: 2 },
      { record: { email: 'b@example.test', name: 'B' }, line: 4 },
      { record: { email: 'c@example.test', name: 'C' }, line: 7 },
    ]);
  });

  it('keeps the header line out of the records and lower-cases the keys', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [' Email Address ', 'Company'],
      ['a@example.test', 'Acme'],
    ]);
    expect(excelRecords(XLSX, sheet)).toEqual([
      {
        record: { 'email address': 'a@example.test', company: 'Acme' },
        line: 2,
      },
    ]);
  });
});

describe('Excel header cell conversion', () => {
  it('accepts primitive, date, and rich-text values without object coercion', () => {
    expect(excelHeaderText(' Email ')).toBe(' Email ');
    expect(excelHeaderText(42)).toBe('42');
    expect(excelHeaderText(false)).toBe('false');
    expect(excelHeaderText(new Date('2024-01-02T03:04:05.000Z'))).toBe(
      '2024-01-02T03:04:05.000Z',
    );
    expect(excelHeaderText({ text: 'Email address' })).toBe('Email address');
    expect(excelHeaderText({ w: 'Formatted header' })).toBe('Formatted header');
    expect(excelHeaderText({ unexpected: 'object' })).toBe('');
    expect(excelHeaderText(null)).toBe('');
  });
});

describe('Excel header validation', () => {
  it('uses the worksheet header when the first data row has blank cells', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['name', 'price', 'stock'],
        ['Blank amounts'],
        ['Full amounts', 12, 3],
      ]),
      'Products',
    );
    const file = new File(
      [XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })],
      'products.xlsx',
    );
    const result = await parseImportFile(
      file,
      () => null,
      (record) => record,
      {
        requiredColumns: [
          { label: 'price', aliases: ['price'] },
          { label: 'stock', aliases: ['stock'] },
        ],
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual([
      { name: 'Blank amounts' },
      { name: 'Full amounts', price: 12, stock: 3 },
    ]);
    expect(result.rows).toEqual([2, 3]);
  });
});
