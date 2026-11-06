import type { Nodes, Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { TASK_REMARK_PLUGINS } from '../markdown/remark-plugin-lists';
import { normalizeHtmlBlocks } from '../markdown/streaming/normalize-html-blocks';
import { MENTION_ELEMENT, remarkMentions } from './remark-mentions';
import { findMentions } from './scan-mentions';

const KINDS = ['user', 'agent', 'automation'] as const;

interface Found {
  text: string;
  properties: Record<string, unknown>;
}

function mentionsIn(markdown: string, plain = true): Found[] {
  const text = normalizeHtmlBlocks(markdown);
  const tree: Root = unified()
    .use(remarkParse)
    .use(TASK_REMARK_PLUGINS)
    .parse(text);
  remarkMentions({ kinds: KINDS, plain })(tree, { value: text });
  const found: Found[] = [];
  const walk = (node: Nodes) => {
    if (node.data?.hName === MENTION_ELEMENT && 'children' in node) {
      const first = node.children[0];
      found.push({
        text: first?.type === 'text' ? first.value : '',
        properties: { ...node.data.hProperties },
      });
      return;
    }
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(tree);
  return found;
}

/** The text a reader sees, each mention element in «». */
function readAs(markdown: string): string {
  const text = normalizeHtmlBlocks(markdown);
  const tree: Root = unified()
    .use(remarkParse)
    .use(TASK_REMARK_PLUGINS)
    .parse(text);
  remarkMentions({ kinds: KINDS })(tree, { value: text });
  const read = (node: Nodes): string => {
    if (node.data?.hName === MENTION_ELEMENT && 'children' in node) {
      return `«${node.children.map(read).join('')}»`;
    }
    if ('value' in node && typeof node.value === 'string') return node.value;
    return 'children' in node ? node.children.map(read).join('') : '';
  };
  return read(tree);
}

describe('remarkMentions', () => {
  it('turns a token into an element with its kind, id and label', () => {
    expect(mentionsIn('Hi [@Ada Lovelace](mention:user/u-1)!')).toEqual([
      {
        text: '@Ada Lovelace',
        properties: {
          dataMentionKind: 'user',
          dataMentionId: 'u-1',
          dataMentionLabel: 'Ada Lovelace',
        },
      },
    ]);
  });

  it('turns a typed handle into an element with the handle', () => {
    expect(mentionsIn('ask @research.bot. and @Mia')).toEqual([
      {
        text: '@research.bot',
        properties: { dataMentionHandle: 'research.bot' },
      },
      { text: '@Mia', properties: { dataMentionHandle: 'mia' } },
    ]);
  });

  it('leaves typed handles alone without plain', () => {
    expect(
      mentionsIn('@alice wrote [@Ada](mention:user/u-1)', false).map(
        (mention) => mention.text,
      ),
    ).toEqual(['@Ada']);
  });

  it('finds mentions in headings, tables, emphasis and lists', () => {
    const markdown = [
      '# For [@Ada](mention:user/u-1)',
      '',
      '| who |',
      '| --- |',
      '| [@Bot](mention:agent/a-1) |',
      '',
      '**@mia** and _[@Ops](mention:automation/ops)_',
      '',
      '- @noah',
    ].join('\n');
    expect(mentionsIn(markdown).map((mention) => mention.text)).toEqual([
      '@Ada',
      '@Bot',
      '@mia',
      '@Ops',
      '@noah',
    ]);
  });

  it('keeps an escaped name whole and reads a split node by its words', () => {
    expect(mentionsIn('a\\_b @ada').map((mention) => mention.text)).toEqual([
      '@ada',
    ]);
  });

  it('puts the chip on the mention, not on an escaped one spelled alike', () => {
    expect(readAs('\\@ada then @ada')).toBe('@ada then «@ada»');
    expect(readAs('&amp; \\@ada, &#64;ada and @ada')).toBe(
      '& @ada, @ada and «@ada»',
    );
    expect(readAs('first \\@ada\n   then @ada')).toBe(
      'first @ada\nthen «@ada»',
    );
  });

  // The renderer and the server read a text through one scan: every chip
  // stands where the server found a mention, and nowhere else.
  it('shows a chip exactly where the server finds a mention', () => {
    const corpus = [
      '`@ada` and ```\n@ops\n``` and @mia',
      '$$\n@ada\n$$ then $5 to @noah and $10',
      '![@ada](mention:user/u-1) [see @ada](https://x.test) ada@example.com',
      '\\@ada [@Ada](mention:user/u-1) *user*@example.com',
      '<div>\n@ada\n</div>\n@mia',
      '    @indented reads as text',
      '> quoted [@Bot](mention:agent/a-1)',
    ];
    for (const markdown of corpus) {
      const chips = mentionsIn(markdown).map((mention) => mention.text);
      const scanned = findMentions(markdown, { kinds: KINDS }).map(
        (occurrence) =>
          occurrence.type === 'token'
            ? `@${occurrence.label}`
            : markdown.slice(occurrence.start, occurrence.end),
      );
      expect(chips, markdown).toEqual(scanned);
    }
  });
});
