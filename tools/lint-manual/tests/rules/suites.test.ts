import { describe, expect, test } from 'bun:test';

import { suites } from '../../src/rules/suites';
import { SMOKE, readme, repo, root, suite } from '../factories';

const header = (prefix: string) =>
  `# S\n\n> **Prefix** \`${prefix}\` · **Reset** none · **Cost** 1m\n\n`;

describe('suites', () => {
  test('a well-formed suite is clean', () => {
    expect(suites(repo())).toEqual([]);
  });

  test('demands a prefix declaration', () => {
    const bare = suite('bare.md', '# Bare\n\n- [ ] `X-1` · **Do** → done.\n');
    const findings = suites(
      repo(root({ suites: [bare], readme: readme('bare.md') })),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'no prefix declared — a suite opens with `> **Prefix** `X-` · **Reset** … · **Cost** …`',
    ]);
  });

  test('rejects a lowercase prefix', () => {
    const bad = suite(
      'bad.md',
      `${header('smoke-')}- [ ] \`smoke-1\` · **Do** → done.\n`,
    );
    const findings = suites(
      repo(root({ suites: [bad], readme: readme('bad.md') })),
    );
    expect(findings[0].message).toContain('is not uppercase letters');
  });

  test('rejects a prefix that shadows another', () => {
    const a = suite('a.md', `${header('P')}- [ ] \`P1\` · **Do** → done.\n`);
    const b = suite('b.md', `${header('P2')}- [ ] \`P21\` · **Do** → done.\n`);
    const findings = suites(
      repo(root({ suites: [a, b], readme: readme('a.md', 'b.md') })),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'prefix `P2` shadows `P` (`a.md`) — one ID would read as both',
    ]);
  });

  test('two suites may continue one numbering', () => {
    const chain = suite(
      'chain.md',
      `${header('P')}- [ ] \`P0.1\` · **Do** → done.\n`,
    );
    const tours = suite(
      'tours.md',
      `${header('P')}- [ ] \`P8.1\` · **Do** → done.\n`,
    );
    expect(
      suites(
        repo(
          root({
            suites: [chain, tours],
            readme: readme('chain.md', 'tours.md'),
          }),
        ),
      ),
    ).toEqual([]);
  });

  test('rejects a box the suite does not own', () => {
    const stray = suite(
      'stray.md',
      `${header('A-')}- [ ] \`B-1\` · **Do** → done.\n`,
    );
    const findings = suites(
      repo(root({ suites: [stray], readme: readme('stray.md') })),
    );
    expect(findings[0].message).toBe(
      "`B-1` does not start with this suite's prefix (`A-`)",
    );
  });

  test('rejects a duplicate ID across two suites', () => {
    const a = suite('a.md', `${header('A-')}- [ ] \`A-1\` · **Do** → done.\n`);
    const b = suite('b.md', `${header('A-2')}- [ ] \`A-1\` · **Do** → done.\n`);
    const findings = suites(
      repo(root({ suites: [a, b], readme: readme('a.md', 'b.md') })),
    );
    expect(findings.map((f) => f.message)).toContain(
      '`A-1` is already defined in `a.md` — an ID is a stable, unique contract',
    );
  });

  test('rejects a ticked box', () => {
    const ticked = suite(
      'ticked.md',
      `${header('T-')}- [x] \`T-1\` · **Do** → done.\n`,
    );
    const findings = suites(
      repo(root({ suites: [ticked], readme: readme('ticked.md') })),
    );
    expect(findings[0].message).toContain('is ticked');
  });

  test('demands a bold action and a judgment', () => {
    const thin = suite(
      'thin.md',
      `${header('T-')}- [ ] \`T-1\` · just do something\n- [ ] \`T-2\` · **Do** it\n`,
    );
    const findings = suites(
      repo(root({ suites: [thin], readme: readme('thin.md') })),
    );
    expect(findings.map((f) => f.message)).toEqual([
      '`T-1` states no judgment — a box reads **action** → what must be true',
      '`T-1` states no action — the thing to do is bold, and comes first',
      '`T-2` states no judgment — a box reads **action** → what must be true',
    ]);
  });

  test('accepts a judgment that lands on a continuation line', () => {
    const wrapped = suite(
      'wrapped.md',
      `${header('W-')}- [ ] \`W-1\` · **Do the long thing that wraps\n  over two lines** → it holds.\n`,
    );
    expect(
      suites(repo(root({ suites: [wrapped], readme: readme('wrapped.md') }))),
    ).toEqual([]);
  });

  test('rejects a checkbox line that is not a box', () => {
    const broken = suite('broken.md', `${header('B-')}- [ ] no id here\n`);
    const findings = suites(
      repo(root({ suites: [broken], readme: readme('broken.md') })),
    );
    expect(findings[0].message).toContain('not a box');
  });

  test('rejects findings stored in a suite', () => {
    const leaky = suite(
      'leaky.md',
      `${header('L-')}- [ ] \`L-1\` · **Do** → done.\n\n## Issues Found\n`,
    );
    const findings = suites(
      repo(root({ suites: [leaky], readme: readme('leaky.md') })),
    );
    expect(findings[0].message).toBe(
      '`## Issues Found` — findings belong in `runs/`, never in a suite',
    );
  });

  test('the guide and the directory must agree', () => {
    const findings = suites(
      repo(
        root({
          suites: [suite('smoke.md', SMOKE)],
          readme: readme('gone.md'),
        }),
      ),
    );
    expect(findings.map((f) => f.message)).toEqual([
      "`suites/smoke.md` is not listed in the guide's suites table",
      'the suites table links `suites/gone.md`, which does not exist',
    ]);
  });

  test('ignores a box inside a code fence', () => {
    const fenced = suite(
      'fenced.md',
      `${header('F-')}- [ ] \`F-1\` · **Do** → done.\n\n\`\`\`\n- [x] \`OTHER-9\` · example\n\`\`\`\n`,
    );
    expect(
      suites(repo(root({ suites: [fenced], readme: readme('fenced.md') }))),
    ).toEqual([]);
  });
});
