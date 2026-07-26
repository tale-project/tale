import { describe, expect, it } from 'vitest';

import { parseSlashInvocation } from './slash';

describe('parseSlashInvocation', () => {
  it('parses a bare invocation with no arguments', () => {
    expect(parseSlashInvocation('/write-docs')).toEqual({
      slug: 'write-docs',
      args: '',
    });
  });

  it('parses arguments after the first whitespace, across lines', () => {
    expect(parseSlashInvocation('/pdf extract the tables')).toEqual({
      slug: 'pdf',
      args: 'extract the tables',
    });
    expect(parseSlashInvocation('/pdf first line\nsecond line')).toEqual({
      slug: 'pdf',
      args: 'first line\nsecond line',
    });
    expect(parseSlashInvocation('/pdf   padded   ')).toEqual({
      slug: 'pdf',
      args: 'padded',
    });
  });

  it('reads everything that is not a well-formed command as prose', () => {
    for (const text of [
      '',
      '/',
      '//write-docs',
      '/Write-Docs',
      '/write_docs',
      '/write-docs-',
      '/-write-docs',
      ' /write-docs',
      '\n/write-docs',
      'send /write-docs please',
      '/write--docs',
      '/skill.name',
    ]) {
      expect(parseSlashInvocation(text)).toBeNull();
    }
  });

  it('refuses reserved and over-long slugs the shape rules refuse', () => {
    expect(parseSlashInvocation('/claude do something')).toBeNull();
    expect(parseSlashInvocation('/anthropic')).toBeNull();
    expect(parseSlashInvocation(`/${'a'.repeat(65)}`)).toBeNull();
    expect(parseSlashInvocation(`/${'a'.repeat(64)}`)).not.toBeNull();
  });
});
