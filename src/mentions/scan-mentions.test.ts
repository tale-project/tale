import { describe, expect, it } from 'vitest';

import {
  cutMentionText,
  dropPartialMentionToken,
  findMentions,
  type MentionOccurrence,
  mentionPlainText,
  relabelMentionTokens,
} from './scan-mentions';

const KINDS = ['user', 'agent', 'automation'] as const;
const ADA = '[@Ada Lovelace](mention:user/u-ada)';

/** What each occurrence reads as: `@handle` for a typed one, `user:u-ada`
 * for a token. */
function scan(markdown: string): string[] {
  return findMentions(markdown, { kinds: KINDS }).map((occurrence) =>
    describeOccurrence(markdown, occurrence),
  );
}

function describeOccurrence(
  markdown: string,
  occurrence: MentionOccurrence<(typeof KINDS)[number]>,
): string {
  const written = markdown.slice(occurrence.start, occurrence.end);
  if (occurrence.type === 'plain') {
    expect(written.toLowerCase()).toBe(`@${occurrence.handle}`);
    return `@${occurrence.handle}`;
  }
  expect(written.startsWith('[@') || written.startsWith('<mention:')).toBe(
    true,
  );
  return `${occurrence.ref.kind}:${occurrence.ref.id}`;
}

/**
 * Where a mention counts. The renderer's chips come from the same parse, so
 * this corpus is also where a chip may appear.
 */
describe('where a text mentions someone', () => {
  it.each<[string, string, string[]]>([
    ['a sentence', '@ada please check', ['@ada']],
    ['a token', `${ADA} please check`, ['user:u-ada']],
    ['a heading', `# Hi ${ADA} and @mia`, ['user:u-ada', '@mia']],
    [
      'a table cell',
      `| who |\n| --- |\n| ${ADA} |\n| @mia |`,
      ['user:u-ada', '@mia'],
    ],
    [
      'bold and italics',
      '**@ada** and _@mia_ and ~~@noah~~',
      ['@ada', '@mia', '@noah'],
    ],
    ['a list', '- @ada\n- [ ] @mia', ['@ada', '@mia']],
    ['a blockquote', '> @ada said\n> @mia agreed', ['@ada', '@mia']],
    ['indented code', 'Trace:\n\n    @ada at main.js:1', []],
    ['a fenced code block', '```\n@Override\n' + ADA + '\n```', []],
    ['inline code', '`@ada` and `' + ADA + '`', []],
    ['display math', '$$\n@ada\n$$', []],
    ['inline double-dollar math', 'see $$x @ada$$ here', []],
    [
      'amounts beside a mention',
      'Budget: $500 approved by @mia, remaining $200',
      ['@mia'],
    ],
    ['amounts around a token', `Pay $5 to ${ADA} and $10`, ['user:u-ada']],
    ['a link’s text', '[ask @ada](https://example.com)', []],
    ['an image of a token', `Hi![@Ada](mention:user/u-ada) there`, []],
    ['a reference link', '[@Ada][a]\n\n[a]: mention:user/u-ada', []],
    [
      'raw HTML',
      '<tale-mention data-mention-id="u-ada">@Ada</tale-mention>',
      [],
    ],
    ['an email address', 'write to ada@example.com', []],
    ['a word before', 'cc:@ada', []],
    ['an escaped at sign', '\\@ada and \\@mia', []],
    ['after an emphasis', '*user*@example.com and `x`@ada and [l](u)@mia', []],
    [
      'a trailing dot',
      'thanks @ada. and @mia.lovelace.',
      ['@ada', '@mia.lovelace'],
    ],
    ['trailing punctuation only', '@. and @-', []],
    ['an unknown kind', '[@Team](mention:team/t1)', []],
    ['an autolink', '<mention:agent/a1>', ['agent:a1']],
    [
      'markdown inside an HTML block',
      '<div>\n**@ada** and ' + ADA + '\n</div>',
      ['@ada', 'user:u-ada'],
    ],
  ])('%s', (_name, markdown, expected) => {
    expect(scan(markdown)).toEqual(expected);
  });

  it('reads a token’s label without the @', () => {
    const [token] = findMentions('[@Ada \\_ L](mention:user/u-ada)', {
      kinds: KINDS,
    });
    expect(token).toMatchObject({ type: 'token', label: 'Ada _ L' });
  });

  it('keeps the offsets of the text it was given, also around HTML blocks', () => {
    const markdown = '<details>\n@ada and @mia\n</details>\n\n@noah';
    const found = findMentions(markdown, { kinds: KINDS });
    expect(
      found.map((occurrence) =>
        markdown.slice(occurrence.start, occurrence.end),
      ),
    ).toEqual(['@ada', '@mia', '@noah']);
  });
});

describe('a text read without markdown', () => {
  const nameOf = (ref: { kind: string; id: string }) =>
    ref.id === 'u-ada' ? 'Ada King' : null;

  it('reads a token as @ and the current name, or its label when the person is gone', () => {
    expect(
      mentionPlainText(
        `${ADA} and [@Mia](mention:user/u-mia) and @noah, \`${ADA}\``,
        { kinds: KINDS, nameOf },
      ),
    ).toBe(`@Ada King and @Mia and @noah, \`${ADA}\``);
  });

  it('reads a mention saved as text, `\\@Name`, as @ and the name', () => {
    expect(
      mentionPlainText('\\@Gone Person left, `\\@code` and \\\\@mia', {
        kinds: KINDS,
        nameOf,
      }),
    ).toBe('@Gone Person left, `\\@code` and \\\\@mia');
  });

  it('gives a token the current name and keeps its address', () => {
    expect(
      relabelMentionTokens(`${ADA} and [@Mia](mention:user/u-mia)`, {
        kinds: KINDS,
        nameOf,
      }),
    ).toBe('[@Ada King](mention:user/u-ada) and [@Mia](mention:user/u-mia)');
  });

  it('cuts without leaving half a token', () => {
    const text = `Please ${ADA} check`;
    expect(cutMentionText(text, 7)).toBe('Please ');
    for (let max = 8; max < 7 + ADA.length; max += 1) {
      expect(cutMentionText(text, max)).toBe('Please');
    }
    expect(cutMentionText(text, 7 + ADA.length)).toBe(`Please ${ADA}`);
    expect(cutMentionText('see [@docs](https://example.com/a', 30)).toBe(
      'see [@docs](https://example.co',
    );
    expect(cutMentionText('short', 30)).toBe('short');
  });

  it('drops the half token a cut made elsewhere left at the end', () => {
    expect(dropPartialMentionToken(`Please ${ADA.slice(0, 20)}`)).toBe(
      'Please',
    );
    expect(dropPartialMentionToken(`Please ${ADA}`)).toBe(`Please ${ADA}`);
    expect(dropPartialMentionToken('see [docs](https://exa')).toBe(
      'see [docs](https://exa',
    );
  });
});
