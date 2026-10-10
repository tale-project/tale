import { loadLocale } from '@tale/ui/i18n/load-locale';
import { beforeAll, describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import {
  conditionText,
  describeCondition,
  describeList,
  type ConditionTextContext,
} from './condition-text';
import { nodeTitle } from './node-face';

/**
 * Conditions in words, in every language the app ships, with the real
 * catalogs: each recognised shape, the ones that stay code, and the German
 * word order — every German phrase completes "wenn …", so its verb comes
 * last.
 */

beforeAll(async () => {
  await loadLocale(i18n, 'de-CH');
});

function ctx(locale: string): ConditionTextContext {
  return {
    t: i18n.getFixedT(locale, 'automations'),
    locale,
    nodeLabel: nodeTitle,
  };
}

const say = (text: string, locale = 'en') => conditionText(text, ctx(locale));

describe('conditionText', () => {
  it.each([
    [
      '{{ nodes.score.output.total > 1000 }}',
      'total of Score is greater than 1,000',
    ],
    ['{{ nodes.score.output.total >= 3 }}', 'total of Score is at least 3'],
    [
      '{{ nodes.score.output.total < input.limit }}',
      'total of Score is less than limit of the run input',
    ],
    ['{{ nodes.score.output.total <= 0 }}', 'total of Score is at most 0'],
    [
      '{{ nodes.classify.output.status === "done" }}',
      'status of Classify is "done"',
    ],
    ['{{ item.state != "open" }}', 'state of the item is not "open"'],
    [
      '{{ nodes.inbox.output.items.length > 0 }}',
      'items of Inbox is not empty',
    ],
    ['{{ nodes.inbox.output.items.length === 0 }}', 'items of Inbox is empty'],
    ['{{ !nodes.inbox.output.items?.length }}', 'items of Inbox is empty'],
    ['{{ nodes.inbox.output.items.length }}', 'items of Inbox is not empty'],
    [
      '{{ nodes.inbox.output.items.length > 3 }}',
      'the number of items of Inbox is greater than 3',
    ],
    ['{{ input.notify }}', 'notify of the run input is set'],
    ['{{ !!input.notify }}', 'notify of the run input is set'],
    ['{{ Boolean(input.notify) }}', 'notify of the run input is set'],
    ['{{ !input.notify }}', 'notify of the run input is not set'],
    [
      '{{ nodes.issue.output.labels.includes("bug") }}',
      'labels of Issue contains "bug"',
    ],
    [
      '{{ !nodes.issue.output.labels.includes("bug") }}',
      'labels of Issue doesn\'t contain "bug"',
    ],
    [
      '{{ item.title.startsWith("RFC") }}',
      'title of the item starts with "RFC"',
    ],
    ['{{ item.title.endsWith("?") }}', 'title of the item ends with "?"'],
    ['{{ output.done === true }}', "done of this pass's result is true"],
    ['{{ index > 2 }}', "the item's position is greater than 2"],
    ['{{ nodes.check.output === null }}', 'the output of Check is empty'],
    ['{{ nodes.check.output?.ok ?? false }}', 'ok of Check is set'],
    [
      '{{ (input.a > 1) && input.b }}',
      'a of the run input is greater than 1 and b of the run input is set',
    ],
    [
      '{{ input.a || input.b || input.c }}',
      'a of the run input is set, b of the run input is set, or c of the run input is set',
    ],
    ['nodes.check.output.ok', 'ok of Check is set'],
    [
      '{{ input.a && (input.b || input.c) }}',
      'a of the run input is set and (b of the run input is set or c of the run input is set)',
    ],
    [
      '{{ (input.a && input.b) || input.c }}',
      '(a of the run input is set and b of the run input is set) or c of the run input is set',
    ],
  ])('says %s', (text, words) => {
    expect(say(text)).toBe(words);
  });

  it.each(['en', 'de', 'fr', 'de-CH'])(
    'tells %s readers which way a mixed condition groups',
    (locale) => {
      const inner = say('{{ input.a && (input.b || input.c) }}', locale);
      const outer = say('{{ (input.a && input.b) || input.c }}', locale);
      expect(inner).not.toBeNull();
      expect(outer).not.toBeNull();
      expect(inner).not.toBe(outer);
      expect(inner).toContain('(');
      expect(outer?.startsWith('(')).toBe(true);
    },
  );

  it.each([
    ['{{ input.a && input.b && input.c && input.d }}'],
    ['{{ input.a && (input.b || (input.c && input.d)) }}'],
    ['{{ nodes.a.output.n * 2 > 3 }}'],
    ['{{ input.list.some((x) => x.ok) }}'],
    ['Ready: {{ input.ok }}'],
    ['{{ true }}'],
    ['{{ nodes[input.name].output }}'],
    ['{{ input.a > }}'],
  ])('keeps %s as code', (text) => {
    expect(say(text)).toBeNull();
  });

  it('says German verb last, after "wenn"', () => {
    expect(say('{{ nodes.score.output.total > 1000 }}', 'de')).toBe(
      'total von Score größer als 1.000 ist',
    );
    expect(say('{{ nodes.issue.output.labels.includes("bug") }}', 'de')).toBe(
      'labels von Issue „bug“ enthält',
    );
    expect(say('{{ input.a > 1 && input.b }}', 'de')).toBe(
      'a der Laufeingabe größer als 1 ist und b der Laufeingabe gesetzt ist',
    );
  });

  it('says French with its own spacing and quotes', () => {
    expect(say('{{ nodes.classify.output.status === "done" }}', 'fr')).toBe(
      'status de Classify vaut «\u00a0done\u00a0»',
    );
    expect(say('{{ nodes.inbox.output.items.length === 0 }}', 'fr')).toBe(
      'items de Inbox est vide',
    );
  });

  it('writes Swiss German without ß and with its own quotes', () => {
    expect(say('{{ nodes.score.output.total > 1000 }}', 'de-CH')).toBe(
      'total von Score grösser als 1’000 ist',
    );
    expect(say('{{ item.state === "open" }}', 'de-CH')).toBe(
      'state des Elements gleich «open» ist',
    );
  });
});

describe('describeCondition', () => {
  it('keeps where each operand sits in the field', () => {
    const text = '{{ nodes.score.output.total > 1000 }}';
    const phrase = describeCondition(text);
    expect(phrase.kind).toBe('compare');
    if (phrase.kind !== 'compare') return;
    expect(text.slice(...phrase.a.range)).toBe('nodes.score.output.total');
    expect(text.slice(...phrase.b.range)).toBe('1000');
  });

  it('looks through ?? and parentheses', () => {
    expect(
      describeCondition('{{ (nodes.a.output.n ?? 0) > 1 }}'),
    ).toMatchObject({
      kind: 'compare',
      op: 'gt',
      a: { root: 'node', nodeId: 'a', path: ['n'] },
    });
  });
});

describe('describeList', () => {
  it('reads a forEach that walks one list', () => {
    expect(describeList('{{ nodes.open_issues.output.issues }}')).toMatchObject(
      { kind: 'ref', root: 'node', nodeId: 'open_issues', path: ['issues'] },
    );
    expect(describeList('{{ input.items }}')).toMatchObject({
      root: 'input',
      path: ['items'],
    });
  });

  it('gives up on anything else', () => {
    expect(describeList('{{ input.items.filter((x) => x) }}')).toBeNull();
    expect(describeList('items: {{ input.items }}')).toBeNull();
  });
});
