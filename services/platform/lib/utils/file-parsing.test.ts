import { describe, it, expect } from 'vitest';

import { parseCSVWithMapper, type RequiredColumn } from './file-parsing';

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
