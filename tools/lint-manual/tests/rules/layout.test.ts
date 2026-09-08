import { describe, expect, test } from 'bun:test';

import { layout } from '../../src/rules/layout';
import { repo, root } from '../factories';

describe('layout', () => {
  test('a complete tree is clean', () => {
    expect(layout(repo())).toEqual([]);
  });

  test('names every missing root file', () => {
    const findings = layout(repo(root({ entries: ['suites'] })));
    expect(findings.map((f) => f.message)).toEqual([
      'missing `readme.md` — every manual root carries it',
      'missing `setup.md` — every manual root carries it',
      'missing `template.md` — every manual root carries it',
      'missing `reference` — every manual root carries it',
      'missing `runs` — every manual root carries it',
    ]);
  });

  test('rejects a stray file at the manual root', () => {
    const findings = layout(
      repo(root({ entries: [...root().entries, 'auth.md'] })),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('services/app/tests/manual/auth.md');
    expect(findings[0].message).toContain('unexpected entry');
  });

  test('allows scripts/ as the authoring-aid slot', () => {
    expect(
      layout(repo(root({ entries: [...root().entries, 'scripts'] }))),
    ).toEqual([]);
  });

  test('a suites directory with no suite is a directory, not a layer', () => {
    const findings = layout(repo(root({ suites: [] })));
    expect(findings.map((f) => f.message)).toContain(
      'no suite — a manual layer with no test is a directory',
    );
  });

  test('names a missing register and a missing run fixture', () => {
    const findings = layout(
      repo(
        root({
          referenceEntries: ['pins.md'],
          runEntries: ['readme.md'],
        }),
      ),
    );
    expect(findings.map((f) => f.file)).toEqual([
      'services/app/tests/manual/reference/automation.md',
      'services/app/tests/manual/reference/error-codes.md',
      'services/app/tests/manual/reference/not-a-finding.md',
      'services/app/tests/manual/runs/template.md',
      'services/app/tests/manual/runs/template-session-log.md',
    ]);
  });
});
