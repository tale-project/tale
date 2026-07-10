import { describe, expect, it } from 'vitest';

import { serializeYamlMap, YamlMapError } from './serialize_yaml_map';

describe('serializeYamlMap', () => {
  it('emits double-quoted values in entry order', () => {
    expect(
      serializeYamlMap({
        client: 'Acme AG',
        vat_number: 'CHE-123.456.789 MWST',
      }),
    ).toBe('client: "Acme AG"\nvat_number: "CHE-123.456.789 MWST"\n');
  });

  it('escapes backslashes and quotes', () => {
    expect(serializeYamlMap({ note: 'say "hi" \\ ok' })).toBe(
      'note: "say \\"hi\\" \\\\ ok"\n',
    );
  });

  it('rejects multiline values', () => {
    expect(() => serializeYamlMap({ bad: 'a\nb' })).toThrow(YamlMapError);
  });

  it('rejects invalid keys', () => {
    expect(() => serializeYamlMap({ 'vat-number': 'x' })).toThrow(YamlMapError);
  });
});
