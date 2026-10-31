import { javascriptLanguage } from '@codemirror/lang-javascript';
import {
  defineLanguageFacet,
  Language,
  languageDataProp,
} from '@codemirror/language';
import {
  NodeSet,
  NodeType,
  parseMixed,
  Parser,
  Tree,
  type Input,
  type NestedParse,
  type ParseWrapper,
  type PartialParse,
  type SyntaxNodeRef,
  type TreeFragment,
} from '@lezer/common';
import { styleTags } from '@lezer/highlight';

import { codeTags } from '../../../../../lib/code-roles';
import { scanTemplates, type TemplateScan } from '../../template-scan';
import { javascriptStyles } from '../language-styles';

export type TemplateScanner = (text: string) => TemplateScan;

/**
 * Language data for text with templates: only `{` auto-closes, so the
 * smart-brace input can turn `{{` into `{{ | }}` while prose quotes and
 * parentheses type as written.
 */
const templateLanguageData = defineLanguageFacet({
  closeBrackets: { brackets: ['{'] },
});

/** A template's body: one JavaScript expression (Lezer's `SingleExpression`). */
export const expressionParser = javascriptLanguage.parser.configure({
  top: 'SingleExpression',
  props: [javascriptStyles],
});

const NODE_NAMES = [
  'TemplateDocument',
  'Template',
  'TemplateBrace',
  'TemplateBody',
  'TemplateUnterminated',
] as const;

type NodeName = (typeof NODE_NAMES)[number];

const nodeSet = new NodeSet(
  NODE_NAMES.map((name, id) =>
    NodeType.define({
      id,
      name,
      top: id === 0,
      props: id === 0 ? [[languageDataProp, templateLanguageData]] : [],
    }),
  ),
).extend(
  styleTags({
    TemplateBrace: codeTags.templateBrace,
    TemplateUnterminated: codeTags.templateUnterminated,
  }),
);

function type(name: NodeName): NodeType {
  return nodeSet.types[NODE_NAMES.indexOf(name)];
}

function leaf(name: NodeName, length: number): Tree {
  return new Tree(type(name), [], [], length);
}

/** The JavaScript under every template's body. */
const nestBodies: ParseWrapper = parseMixed(
  (node: SyntaxNodeRef): NestedParse | null =>
    node.name === 'TemplateBody' ? { parser: expressionParser } : null,
);

/**
 * Reads the parsed ranges as one string, with whatever lies between two
 * ranges blanked out: a template never starts in a gap, and offsets stay
 * the document's minus the first range's start.
 */
function readRanges(
  input: Input,
  ranges: ReadonlyArray<{ from: number; to: number }>,
): string {
  const base = ranges[0].from;
  let text = '';
  for (const range of ranges) {
    text += ' '.repeat(range.from - base - text.length);
    text += input.read(range.from, range.to);
  }
  return text;
}

class TemplateParse implements PartialParse {
  parsedPos: number;
  stoppedAt: number | null = null;

  constructor(
    private readonly input: Input,
    private readonly ranges: ReadonlyArray<{ from: number; to: number }>,
    private readonly scanner: TemplateScanner,
  ) {
    this.parsedPos = ranges[0].from;
  }

  advance(): Tree {
    const text = readRanges(this.input, this.ranges);
    const { spans, unterminated } = this.scanner(text);
    const nodes: Array<[number, Tree]> = [];
    for (const span of spans) {
      const body = span.bodyTo - span.bodyFrom;
      nodes.push([
        span.open,
        new Tree(
          type('Template'),
          [
            leaf('TemplateBrace', span.bodyFrom - span.open),
            leaf('TemplateBody', body),
            leaf('TemplateBrace', span.end - span.bodyTo),
          ],
          [0, span.bodyFrom - span.open, span.bodyTo - span.open],
          span.end - span.open,
        ),
      ]);
    }
    for (const [from, to] of unterminated) {
      nodes.push([from, leaf('TemplateUnterminated', to - from)]);
    }
    nodes.sort((a, b) => a[0] - b[0]);
    this.parsedPos = this.ranges[this.ranges.length - 1].to;
    return new Tree(
      type('TemplateDocument'),
      nodes.map(([, tree]) => tree),
      nodes.map(([from]) => from),
      text.length,
    );
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }
}

/** Text with `{{ js }}` templates in it. */
class TemplateParser extends Parser {
  constructor(private readonly scanner: TemplateScanner) {
    super();
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    return nestBodies(
      new TemplateParse(input, ranges, this.scanner),
      input,
      fragments,
      ranges,
    );
  }
}

const parsers = new WeakMap<TemplateScanner, TemplateParser>();

/** One parser per scanner, so a language built twice shares its trees. */
function templateParser(
  scanner: TemplateScanner = scanTemplates,
): TemplateParser {
  let parser = parsers.get(scanner);
  if (parser === undefined) {
    parser = new TemplateParser(scanner);
    parsers.set(scanner, parser);
  }
  return parser;
}

const languages = new WeakMap<TemplateScanner, Language>();

/** The whole field is text with templates (`template`, `text` + templates). */
export function templateLanguage(
  scanner: TemplateScanner = scanTemplates,
): Language {
  let language = languages.get(scanner);
  if (language === undefined) {
    language = new Language(
      templateLanguageData,
      templateParser(scanner),
      [],
      'template',
    );
    languages.set(scanner, language);
  }
  return language;
}

/**
 * The overlay that lays a field's templates over a string value in JSON,
 * YAML or Markdown code: only the `{{ … }}` spans themselves (and any
 * unclosed `{{`), so the text around them keeps its string colour. `null`
 * when the content holds no `{{`.
 */
export function templateOverlay(
  input: Input,
  from: number,
  to: number,
  scanner: TemplateScanner,
): NestedParse | null {
  if (to <= from) return null;
  const text = input.read(from, to);
  if (!text.includes('{{')) return null;
  const { spans, unterminated } = scanner(text);
  const ranges = [
    ...spans.map((span) => ({ from: from + span.open, to: from + span.end })),
    ...unterminated.map(([start, end]) => ({
      from: from + start,
      to: from + end,
    })),
  ].sort((a, b) => a.from - b.from);
  if (ranges.length === 0) return null;
  return { parser: templateParser(scanner), overlay: ranges };
}
