import { beforeAll, describe, expect, it } from 'vitest';

import { CODE_LANGUAGES, codeRoleOfColor } from '../lib/code-roles';
import {
  highlightCode,
  peekCodeTokens,
  peekHighlightedCode,
  resolveLanguage,
  resolveShikiTheme,
  shikiLanguageFor,
  tokenizeCode,
} from './shiki';

/** The text of every `<span style="color:var(--code-…)">` with its role. */
function roles(html: string): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  for (const match of html.matchAll(
    /<span style="color:([^;"]+)[^"]*">([^<]*)<\/span>/g,
  )) {
    const text = match[2]
      .replaceAll('&#x3C;', '<')
      .replaceAll('&#x26;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'");
    out.push([text, codeRoleOfColor(match[1])]);
  }
  return out;
}

function roleOf(html: string, text: string): string | null | undefined {
  return roles(html).find(([token]) => token.trim() === text)?.[1];
}

describe('resolveShikiTheme', () => {
  it.each([
    'light',
    'dark',
    'github-light',
    'github-dark',
    'min-light',
    'min-dark',
  ] as const)('maps %s onto the one css-variables theme', (alias) => {
    expect(resolveShikiTheme(alias)).toBe('tale-code');
  });
});

describe('highlightCode palette', () => {
  // Shiki stops tokenizing a line after 500 ms and leaves its rest plain.
  // The first TypeScript highlight compiles the grammar's patterns, which on
  // a loaded machine can take that long, so a different snippet pays for it.
  beforeAll(async () => {
    await highlightCode('let warm = 0; // warm up\nreturn "w";', 'ts');
  }, 60_000);

  // The read-only blocks failed AA with min-light/min-dark (comments 1.69:1).
  // They now colour through the `--code-*` variables, the editor's palette.
  it('colours tokens through the --code-* variables, never a hex value', async () => {
    const result = await highlightCode(
      'const x = 1; // note\nreturn "a";',
      'ts',
    );
    expect(result?.html).toContain('class="shiki tale-code"');
    expect(result?.html).toContain('var(--code-token-keyword)');
    expect(result?.html).toContain('var(--code-token-comment)');
    expect(result?.html).not.toMatch(/color:#[0-9a-f]{3,8}/i);
  });

  it('gives light and dark the same HTML, cached once', async () => {
    const code = 'const theme = "any"; // one cache entry';
    const light = await highlightCode(code, 'ts', 'light');
    expect(peekHighlightedCode(code, 'ts', 'dark')).toBe(light);
    expect(await highlightCode(code, 'ts', 'github-dark')).toBe(light);
  });
});

describe('diff highlighting', () => {
  it('resolves .patch onto the diff grammar', () => {
    expect(resolveLanguage('patch')).toBe('diff');
    expect(resolveLanguage('diff')).toBe('diff');
  });

  // REGRESSION: a theme without colours for the diff scopes rendered a
  // previewed .patch file fully monochrome. Added and removed lines must keep
  // distinct colours, and the hunk range its own.
  it('colors added and removed lines distinctly', async () => {
    const result = await highlightCode(
      '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n',
      'patch',
    );
    expect(result?.language).toBe('diff');
    expect(result?.html).toContain('var(--code-token-inserted)');
    expect(result?.html).toContain('var(--code-token-deleted)');
    expect(result?.html).toContain('var(--code-token-function)');
  });
});

describe('remembered highlights', () => {
  // A chat tokenized every code block again each time it opened, and showed
  // it plain until the highlight arrived.
  it('answers a snippet highlighted before, the same result, from memory', async () => {
    const code = 'export const answer = 42; // remembered';
    expect(peekHighlightedCode(code, 'ts')).toBeNull();

    const first = await highlightCode(code, 'ts');
    expect(first).not.toBeNull();
    expect(peekHighlightedCode(code, 'typescript')).toBe(first);
    expect(await highlightCode(code, 'ts')).toBe(first);
  });

  it('keeps languages apart', async () => {
    const code = 'const lang = "ts"; // remembered per language';
    await highlightCode(code, 'ts');
    expect(peekHighlightedCode(code, 'js')).toBeNull();
  });

  it('remembers nothing for a snippet too large to highlight', async () => {
    const code = 'x'.repeat(70_000);
    expect(await highlightCode(code, 'text')).toBeNull();
    expect(peekHighlightedCode(code, 'text')).toBeNull();
  });
});

describe('tokenizeCode', () => {
  // A diff tokenizes each whole text once and shows the tokens line by
  // line: a line inside a YAML block scalar is only a string in its whole
  // document.
  it('answers each line’s runs in the --code-* colours', async () => {
    const yaml = 'prompt: |\n  Say hello\n  to the user\ncount: 3\n';
    const lines = await tokenizeCode(yaml, 'yaml');
    expect(lines).not.toBeNull();
    expect(
      lines?.map((line) => line.map((token) => token.content).join('')),
    ).toEqual(['prompt: |', '  Say hello', '  to the user', 'count: 3', '']);
    const role = (line: number, text: string) =>
      codeRoleOfColor(
        lines?.[line]?.find((token) => token.content.trim() === text)?.color,
      );
    expect(role(1, 'Say hello')).toBe('string');
    expect(role(3, '3')).toBe('constant');
    for (const line of lines ?? [])
      for (const token of line)
        expect(token.color ?? 'var(--code-foreground)').toMatch(
          /^var\(--code-/,
        );
  });

  it('remembers a text it tokenized, per language, and nothing too large', async () => {
    const code = 'const tokens = "remembered";';
    expect(peekCodeTokens(code, 'ts')).toBeNull();
    const first = await tokenizeCode(code, 'ts');
    expect(peekCodeTokens(code, 'typescript')).toBe(first);
    expect(peekCodeTokens(code, 'js')).toBeNull();
    const big = 'x'.repeat(70_000);
    expect(await tokenizeCode(big, 'text')).toBeNull();
    expect(peekCodeTokens(big, 'text')).toBeNull();
  });
});

describe('template grammars', () => {
  it('names a grammar for every code language', () => {
    expect(
      Object.fromEntries(
        CODE_LANGUAGES.map((language) => [
          language,
          [shikiLanguageFor(language), shikiLanguageFor(language, true)],
        ]),
      ),
    ).toEqual({
      javascript: ['javascript', 'javascript'],
      expression: ['javascript', 'javascript'],
      json: ['json', 'json-template'],
      yaml: ['yaml', 'yaml-template'],
      markdown: ['markdown', 'markdown-template'],
      template: ['tale-template', 'tale-template'],
      text: ['text', 'tale-template'],
    });
  });

  it('resolves the template aliases', () => {
    expect(resolveLanguage('template')).toBe('tale-template');
    expect(resolveLanguage('json+template')).toBe('json-template');
    expect(resolveLanguage('yml+template')).toBe('yaml-template');
    expect(resolveLanguage('md+template')).toBe('markdown-template');
  });

  it('highlights the body of a template as JavaScript', async () => {
    const result = await highlightCode(
      'Hello {{ nodes.triage.output.name }}!',
      'tale-template',
    );
    expect(result?.language).toBe('tale-template');
    const html = result?.html ?? '';
    expect(roleOf(html, '{{')).toBe('keyword');
    expect(roleOf(html, '}}')).toBe('keyword');
    expect(roleOf(html, 'nodes')).toBe('constant');
    expect(roleOf(html, 'Hello')).toBe('foreground');
  });

  it('closes a template at the brace the expression leaves open', async () => {
    const html =
      (await highlightCode('{{ "}}" }} tail', 'tale-template'))?.html ?? '';
    expect(roleOf(html, '"}}"')).toBe('string-expression');
    expect(roleOf(html, 'tail')).toBe('foreground');
  });

  it('finds templates inside JSON strings, not in plain JSON', async () => {
    const code = '{"to": "{{ input.email }}"}';
    const templated = (await highlightCode(code, 'json-template'))?.html ?? '';
    expect(roleOf(templated, 'input')).toBe('constant');
    const plain = (await highlightCode(code, 'json'))?.html ?? '';
    expect(roleOf(plain, 'input')).toBeUndefined();
  });

  // Helm, Jinja and Go templates in a chat answer are `yaml`: their braces
  // must stay text there.
  it('leaves templates in plain YAML alone', async () => {
    const code = 'prompt: hi {{ item.x }}\n';
    const templated = (await highlightCode(code, 'yaml-template'))?.html ?? '';
    expect(roleOf(templated, '{{')).toBe('keyword');
    expect(roleOf(templated, 'item')).toBe('constant');
    const plain = (await highlightCode(code, 'yaml'))?.html ?? '';
    expect(roleOf(plain, '{{')).toBeUndefined();
    expect(roleOf(plain, 'item')).toBeUndefined();
  });

  it('highlights templates in Markdown prose', async () => {
    const html =
      (
        await highlightCode(
          'Use {{ nodes.a.output }} *now*',
          'markdown-template',
        )
      )?.html ?? '';
    expect(roleOf(html, 'nodes')).toBe('constant');
  });
});
