import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

import {
  excelRecords,
  parseCSVWithMapper,
  type RequiredColumn,
} from './file-parsing';

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
