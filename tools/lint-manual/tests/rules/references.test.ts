import { describe, expect, test } from 'bun:test';

import { references } from '../../src/rules/references';
import { doc, repo, root } from '../factories';

const ROOT = 'services/app/tests/manual';
const register = (name: string, text: string) =>
  doc(name, text, `${ROOT}/reference`);

const withReference = (name: string, text: string) => {
  const base = root();
  return repo(
    root({
      reference: base.reference.map((d) =>
        d.name === name ? register(name, text) : d,
      ),
    }),
  );
};

describe('references', () => {
  test('empty registers are clean', () => {
    expect(references(repo())).toEqual([]);
  });

  test('a pin keyed to a live box is clean', () => {
    expect(
      references(withReference('pins.md', '| `SMOKE-1` | it once broke |\n')),
    ).toEqual([]);
  });

  test('a pin keyed to a dead box is a finding', () => {
    const findings = references(
      withReference('pins.md', '| `SMOKE-9` | it once broke |\n'),
    );
    expect(findings).toEqual([
      {
        file: `${ROOT}/reference/pins.md`,
        message: 'cites `SMOKE-9`, which no suite defines',
      },
    ]);
  });

  test('a group citation resolves to the boxes inside it', () => {
    const base = root();
    base.suites[0].boxes.push({
      id: 'SMOKE-3.1',
      line: 9,
      ticked: false,
      body: '**Do** → done.',
    });
    expect(
      references(
        repo({
          ...base,
          reference: base.reference.map((d) =>
            d.name === 'pins.md'
              ? register('pins.md', 'run `SMOKE-3` first\n')
              : d,
          ),
        }),
      ),
    ).toEqual([]);
  });

  test('an ordinary backticked word is not read as a box', () => {
    expect(
      references(
        withReference('automation.md', 'The `SMOKE` word and `SMOKE-`.\n'),
      ),
    ).toEqual([]);
  });

  test('debt cited anywhere must be on the debt register', () => {
    const findings = references(
      withReference('pins.md', 'see `BL-4` for the gap\n'),
    );
    expect(findings[0].message).toBe(
      'cites `BL-4`, which the debt register does not define',
    );
  });

  test('a defined debt row satisfies its citations', () => {
    const base = root();
    const findings = references(
      repo(
        root({
          reference: base.reference.map((d) => {
            if (d.name === 'pins.md')
              return register('pins.md', 'see `BL-4`\n');
            if (d.name === 'not-a-finding.md')
              return register(
                'not-a-finding.md',
                '| `BL-4` | the gap | the trigger |\n',
              );
            return d;
          }),
        }),
      ),
    );
    expect(findings).toEqual([]);
  });
});
