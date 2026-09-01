import { describe, expect, it } from 'vitest';

import { parseYamlMap } from './parse_yaml_map';
import { serializeYamlMap } from './serialize_yaml_map';

describe('parseYamlMap', () => {
  it('reads a double-quoted flat value (the validation-policy shape)', () => {
    expect(parseYamlMap('method: "daily_sell"\n')).toEqual({
      method: 'daily_sell',
    });
  });

  it('round-trips serializeYamlMap output', () => {
    const map = { method: 'strict_rules', note: 'has: a colon # and hash' };
    expect(parseYamlMap(serializeYamlMap(map))).toEqual(map);
  });

  it('tolerates bare and single-quoted values from hand-authored files', () => {
    expect(parseYamlMap('method: strict_rules')).toEqual({
      method: 'strict_rules',
    });
    expect(parseYamlMap("method: 'custom_rules'")).toEqual({
      method: 'custom_rules',
    });
  });

  it('ignores comments and blank lines', () => {
    expect(parseYamlMap('# operator FX policy\n\nmethod: "fixed"\n')).toEqual({
      method: 'fixed',
    });
  });

  it('strips a trailing inline comment on a bare value only', () => {
    expect(parseYamlMap('method: daily_sell # as booked')).toEqual({
      method: 'daily_sell',
    });
    // A quoted value keeps a '#' that lives inside the quotes.
    expect(parseYamlMap('label: "rate #1"')).toEqual({ label: 'rate #1' });
  });

  it('unescapes double-quoted specials', () => {
    expect(parseYamlMap('k: "a \\"b\\" c"')).toEqual({ k: 'a "b" c' });
  });

  it('surfaces only flat scalars — nested blocks are skipped', () => {
    expect(
      parseYamlMap('rates:\n  EUR: "0.93"\nmethod: "strict_rules"'),
    ).toEqual({ method: 'strict_rules' });
  });

  it('returns an empty map for empty or value-less input', () => {
    expect(parseYamlMap('')).toEqual({});
    expect(parseYamlMap('\n\n')).toEqual({});
  });
});
