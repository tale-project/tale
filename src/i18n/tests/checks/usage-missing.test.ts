import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findMissingKeyRefs } from './usage-missing';

/**
 * Fixture-driven coverage for the reverse usage check: a temp service root
 * with a small catalog and one source file per case. Guards the #2414 bug
 * class (a dropped subtree renders raw keys with parity + orphan green) and
 * pins every skip rule that keeps the check false-positive free.
 */

let root: string;

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-missing-'));
  write(
    'messages/en.yml',
    JSON.stringify({
      metrics: { title: 'Metrics', cards: { total: 'Total' } },
      chat: { send: 'Send' },
    }),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('findMissingKeyRefs', () => {
  it('flags a static t() call whose key is missing from the catalog', () => {
    write(
      'app/page.tsx',
      `const { t } = useT('metrics');
       t('title');
       t('cards.totalRuns');`,
    );
    const findings = findMissingKeyRefs({ serviceRoot: root });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: 'app/page.tsx',
      line: 3,
      key: 'metrics.cards.totalRuns',
      rule: 'referenced-key-missing',
    });
  });

  it('checks every namespace of an array binding before flagging', () => {
    write(
      'app/multi.tsx',
      `const { t } = useTranslation(['metrics', 'chat']);
       t('send');
       t('nowhere');`,
    );
    const findings = findMissingKeyRefs({ serviceRoot: root });
    expect(findings.map((f) => f.key)).toEqual(['metrics.nowhere']);
  });

  it('skips prefix concatenations, defaultValue fallbacks, unknown namespaces, and allowlisted prefixes', () => {
    write('lib/i18n/keys-dynamic.yml', 'entries:\n  - metrics.dynamic\n');
    write(
      'app/skips.tsx',
      `const { t } = useT('metrics');
       t('cards.' + kind);
       t('missing.with.fallback', { defaultValue: status });
       t('dynamic.someRuntimeKey');
       const { t: tOther } = useT('notARealNamespace');
       tOther('anything.goes');`,
    );
    expect(findMissingKeyRefs({ serviceRoot: root })).toEqual([]);
  });

  it('ignores test and story files', () => {
    write(
      'app/page.test.tsx',
      `const { t } = useT('metrics');
       t('cards.totalRuns');`,
    );
    expect(findMissingKeyRefs({ serviceRoot: root })).toEqual([]);
  });
});

describe('alias shadowing', () => {
  it('skips an alias that also has a competing direct binding', () => {
    write(
      'app/shadowed.tsx',
      `function useFallback() {
         const { t } = useT('metrics');
         return t;
       }
       const t = useFallback();
       t('not.a.real.key');`,
    );
    expect(findMissingKeyRefs({ serviceRoot: root })).toEqual([]);
  });
});
