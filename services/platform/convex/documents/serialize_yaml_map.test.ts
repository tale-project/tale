import { describe, expect, it } from 'vitest';

import { serializeYamlMap, YamlMapError } from './serialize_yaml_map';

describe('serializeYamlMap', () => {
  it('emits double-quoted values in entry order', () => {
    expect(
      serializeYamlMap({
        client: 'Acme AG',
        levy_account: 'NP-123.456.789 LEVY',
      }),
    ).toBe('client: "Acme AG"\nlevy_account: "NP-123.456.789 LEVY"\n');
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
    expect(() => serializeYamlMap({ 'levy-number': 'x' })).toThrow(
      YamlMapError,
    );
  });
});
