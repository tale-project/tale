/**
 * A condition as it decided in a run, in words: the sentence the canvas
 * shows for it, said the way it came out ("amount of the run input (250) is
 * not greater than 1000"), each value it read in parentheses after the
 * reference that read it. A condition joined with `&&` or `||` also reads
 * part by part — each with its own sentence and whether it held, or that
 * the run never checked it (a short circuit).
 *
 * The values come from the record's explanation of the condition
 * (`lib/engine/core/record/explain.ts`): one tree per evaluated expression,
 * each node with its range in the condition's text — the same text, and so
 * the same ranges, the phrase's operands were read from.
 */

import type { ValueSummary } from '@tale/ui/data/value-summary';

import type { ExplainNode } from '@/lib/engine/core/record/explain';

import {
  type ConditionTextContext,
  describeCondition,
  type Operand,
  type Phrase,
  renderCondition,
  renderOperand,
} from './condition-text';

export type ConditionVerdict = 'yes' | 'no' | 'notChecked';

export interface ConditionPart {
  /** The part in words, said the way it came out; null when it reads only
   *  as code. */
  sentence: string | null;
  verdict: ConditionVerdict;
}

export interface ConditionWithValues {
  /** The whole condition in words, said the way it came out; null when it
   *  reads only as code. */
  sentence: string | null;
  /** A condition joined with `&&` or `||`: how each part came out. */
  parts?: { joined: 'and' | 'or'; items: ConditionPart[] };
}

/** The explanation's nodes, every level. */
function flatten(nodes: readonly ExplainNode[]): ExplainNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The smallest explained expression that spans `[start, end)`. */
function nodeSpanning(
  nodes: readonly ExplainNode[],
  start: number,
  end: number,
): ExplainNode | undefined {
  let best: ExplainNode | undefined;
  for (const node of nodes) {
    const [from, to] = node.range;
    if (from > start || to < end) continue;
    if (best === undefined || to - from < best.range[1] - best.range[0]) {
      best = node;
    }
  }
  return best;
}

/** Every operand a phrase reads, in order. */
function operandsOf(phrase: Phrase): Operand[] {
  switch (phrase.kind) {
    case 'raw':
      return [];
    case 'and':
    case 'or':
      return phrase.parts.flatMap(operandsOf);
    case 'compare':
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
      return [phrase.a, phrase.b];
    default:
      return [phrase.a];
  }
}

/** Whether a value counts as true, as JavaScript reads it. */
function truthy(summary: ValueSummary): boolean | undefined {
  switch (summary.kind) {
    case 'boolean':
      return summary.text === 'true';
    case 'string':
      return (summary.length ?? summary.text?.length ?? 0) > 0;
    case 'number':
      return summary.text !== '0' && summary.text !== 'NaN';
    case 'array':
    case 'object':
      return true;
    case 'null':
    case 'undefined':
      return false;
    default:
      return undefined;
  }
}

/** A value in a sentence: "“normal”", "250", "12 items", "empty". */
export function valueWords(
  summary: ValueSummary,
  ctx: ConditionTextContext,
): string {
  const { t } = ctx;
  switch (summary.kind) {
    case 'string':
      return t('condition.quote', {
        text: `${summary.text ?? ''}${summary.cut === true ? '…' : ''}`,
      });
    case 'number': {
      // Written the way the sentence writes its own numbers ("1,000").
      const number = Number(summary.text);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(ctx.locale).format(number)
        : (summary.text ?? '');
    }
    case 'boolean':
      return summary.text === 'true'
        ? t('condition.literal.valueTrue')
        : t('condition.literal.valueFalse');
    case 'null':
      return t('condition.literal.valueNull');
    case 'undefined':
      return t('values.missing', { ns: 'automationRuns' });
    case 'array':
      return t('values.items', {
        ns: 'automationRuns',
        count: summary.length ?? 0,
      });
    case 'object':
      return t('values.fields', {
        ns: 'automationRuns',
        count: summary.keys ?? 0,
      });
    case 'redacted':
      return t('values.withheld', { ns: 'automationRuns' });
    default:
      return t('values.tooLarge', { ns: 'automationRuns' });
  }
}

/**
 * `source` (a condition's text) the way it came out in a run, with the
 * values `explanation` kept for it. Without an explanation the sentence
 * still says how it came out, without values.
 */
export function conditionWithValues(
  source: string,
  explanation: readonly ExplainNode[] | undefined,
  result: boolean,
  ctx: ConditionTextContext,
): ConditionWithValues {
  const phrase = describeCondition(source);
  const nodes = flatten(explanation ?? []);
  const valueAt = (range: readonly [number, number]) =>
    nodes.find(
      (node) => node.range[0] === range[0] && node.range[1] === range[1],
    )?.value;
  const operand = (target: Operand, context: ConditionTextContext) => {
    const words = renderOperand(target, context);
    if (target.kind !== 'ref') return words;
    const value = valueAt(target.range);
    return value === undefined
      ? words
      : context.t('condition.withValue', {
          operand: words,
          value: valueWords(value, context),
        });
  };
  const sentence = renderCondition(phrase, ctx, {
    operand,
    negated: !result,
  });
  if (phrase.kind !== 'and' && phrase.kind !== 'or') return { sentence };
  const items = phrase.parts.map((part): ConditionPart => {
    const ranges = operandsOf(part).map((each) => each.range);
    const start = Math.min(...ranges.map((range) => range[0]));
    const end = Math.max(...ranges.map((range) => range[1]));
    const node =
      ranges.length === 0 ? undefined : nodeSpanning(nodes, start, end);
    const held =
      node === undefined || !node.evaluated || node.value === undefined
        ? undefined
        : truthy(node.value);
    const verdict: ConditionVerdict =
      node !== undefined && !node.evaluated
        ? 'notChecked'
        : held === undefined
          ? 'notChecked'
          : held
            ? 'yes'
            : 'no';
    return {
      sentence: renderCondition(part, ctx, {
        operand,
        negated: verdict === 'no',
      }),
      verdict,
    };
  });
  return { sentence, parts: { joined: phrase.kind, items } };
}
