import { loadLocale } from '@tale/ui/i18n/load-locale';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ExplainNode } from '@/lib/engine/core/record/explain';
import { i18n } from '@/tests/utils/i18n-all-languages';

import type { ConditionTextContext } from './condition-text';
import { conditionWithValues } from './condition-values';
import { nodeTitle } from './node-face';

/**
 * Conditions as they decided in a run, with the real catalogs: the
 * sentence said the way the condition came out, each value it read beside
 * the reference that read it, and a joined condition part by part.
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

/** An explained expression: `part`'s range in `field`, and what it came to. */
function at(
  field: string,
  part: string,
  value: ExplainNode['value'],
  children: ExplainNode[] = [],
  evaluated = true,
): ExplainNode {
  const start = field.indexOf(part);
  if (start === -1) throw new Error(`${part} is not in ${field}`);
  return {
    range: [start, start + part.length],
    source: part,
    kind: 'other',
    evaluated,
    ...(value !== undefined && { value }),
    children,
  };
}

const AMOUNT = '{{ input.amount > 1000 }}';
const amountExplained = [
  at(AMOUNT, 'input.amount > 1000', { kind: 'boolean', text: 'false' }, [
    at(AMOUNT, 'input.amount', { kind: 'number', text: '250' }),
    at(AMOUNT, '1000', { kind: 'number', text: '1000' }),
  ]),
];

const URGENT = "{{ nodes.triage.output.status === 'urgent' && input.notify }}";
const urgentExplained = [
  at(
    URGENT,
    "nodes.triage.output.status === 'urgent' && input.notify",
    { kind: 'boolean', text: 'false' },
    [
      at(
        URGENT,
        "nodes.triage.output.status === 'urgent'",
        { kind: 'boolean', text: 'false' },
        [
          at(URGENT, 'nodes.triage.output.status', {
            kind: 'string',
            text: 'normal',
            length: 6,
          }),
        ],
      ),
      at(URGENT, 'input.notify', undefined, [], false),
    ],
  ),
];

describe('conditionWithValues', () => {
  it('says a condition that did not hold the way it did not, with what it read', () => {
    expect(
      conditionWithValues(AMOUNT, amountExplained, false, ctx('en')),
    ).toEqual({
      sentence: 'amount of the run input (250) is not greater than 1,000',
    });
    expect(
      conditionWithValues(AMOUNT, amountExplained, false, ctx('de')).sentence,
    ).toBe('amount der Laufeingabe (250) nicht größer als 1.000 ist');
    expect(
      conditionWithValues(AMOUNT, amountExplained, false, ctx('de-CH'))
        .sentence,
    ).toBe('amount der Laufeingabe (250) nicht grösser als 1’000 ist');
    expect(
      conditionWithValues(AMOUNT, amountExplained, false, ctx('fr')).sentence,
    ).toBe('amount de l’entrée (250) n’est pas supérieur à 1 000');
  });

  it('says a condition that held as written, without values when none were kept', () => {
    expect(conditionWithValues(AMOUNT, undefined, true, ctx('en'))).toEqual({
      sentence: 'amount of the run input is greater than 1,000',
    });
  });

  it('reads a joined condition part by part, a part never checked as such', () => {
    const answer = conditionWithValues(
      URGENT,
      urgentExplained,
      false,
      ctx('en'),
    );
    expect(answer.parts).toEqual({
      joined: 'and',
      items: [
        {
          sentence: 'status of Triage ("normal") is not "urgent"',
          verdict: 'no',
        },
        { sentence: 'notify of the run input is set', verdict: 'notChecked' },
      ],
    });
    // Not all held: one of them did not.
    expect(answer.sentence).toBe(
      'status of Triage ("normal") is not "urgent" or notify of the run input is not set',
    );
  });

  it('keeps a condition written as code as code', () => {
    expect(
      conditionWithValues(
        '{{ Object.keys(input).length % 2 === 1 }}',
        undefined,
        true,
        ctx('en'),
      ),
    ).toEqual({ sentence: null });
  });
});
