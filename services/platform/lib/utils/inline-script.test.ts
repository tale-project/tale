import * as vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { inlineScriptJson, replaceLiteral } from './inline-script';

describe('inlineScriptJson', () => {
  it('writes <, > and & as unicode escapes', () => {
    expect(inlineScriptJson('</script><!-- a&b -->')).toBe(
      '"\\u003c/script\\u003e\\u003c!-- a\\u0026b --\\u003e"',
    );
  });

  it('reads back as the same value', () => {
    const value = {
      url: "https://support.example.com/a$'b?x=$`&y=$$#</script>",
      list: ['<!--', '-->'],
      n: 1,
    };
    const window: Record<string, unknown> = {};
    vm.runInNewContext(`window.value = ${inlineScriptJson(value)};`, {
      window,
    });
    expect(window.value).toEqual(value);
    expect(JSON.parse(inlineScriptJson(value))).toEqual(value);
  });
});

describe('replaceLiteral', () => {
  it.each(["$'", '$`', '$&', '$$'])('inserts %s as written', (pattern) => {
    expect(replaceLiteral('<a>MARK</a>', 'MARK', `x${pattern}y`)).toBe(
      `<a>x${pattern}y</a>`,
    );
    expect(replaceLiteral('<a>MARK</a>', /MARK/, `x${pattern}y`)).toBe(
      `<a>x${pattern}y</a>`,
    );
  });

  it('replaces the first match only', () => {
    expect(replaceLiteral('<head><head>', '<head>', '<head><base>')).toBe(
      '<head><base><head>',
    );
  });
});
