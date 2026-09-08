import type { Doc, ManualRoot, Repo, Suite } from '../src/model';
import { parseSuite } from '../src/parse';

const ROOT = 'services/app/tests/manual';

export function doc(name: string, text: string, dir = ROOT): Doc {
  return { name, path: `${dir}/${name}`, text };
}

/** A suite parsed from real markdown, so tests exercise the real grammar. */
export function suite(name: string, body: string): Suite {
  return parseSuite(name, `${ROOT}/suites/${name}`, body);
}

export const SMOKE = `# Smoke

> **Prefix** \`SMOKE-\` · **Reset** none · **Cost** ~10 min

## Boxes

- [ ] \`SMOKE-1\` · **Open the app** → it renders.
- [ ] \`SMOKE-2\` · **Reload it** → the route survives.
`;

/** A guide whose suites table lists exactly the suites passed in. */
export function readme(...suites: string[]): Doc {
  const rows = suites
    .map(
      (name) => `| [${name}](suites/${name}) | \`X-\` | a suite | none | 1m |`,
    )
    .join('\n');
  return doc(
    'readme.md',
    `# Manual tests\n\n## The suites\n\n| Suite | Prefix | What | Resets | Cost |\n|---|---|---|---|---|\n${rows}\n`,
  );
}

export function root(overrides: Partial<ManualRoot> = {}): ManualRoot {
  const suites = overrides.suites ?? [suite('smoke.md', SMOKE)];
  return {
    path: ROOT,
    entries: [
      'readme.md',
      'reference',
      'runs',
      'setup.md',
      'suites',
      'template.md',
    ],
    readme: readme(...suites.map((s) => s.name)),
    suites,
    referenceEntries: [
      'automation.md',
      'error-codes.md',
      'not-a-finding.md',
      'pins.md',
    ],
    reference: [
      doc('automation.md', '# Automation\n', `${ROOT}/reference`),
      doc('error-codes.md', '# Codes\n', `${ROOT}/reference`),
      doc('not-a-finding.md', '# Not a finding\n', `${ROOT}/reference`),
      doc('pins.md', '# Pins\n', `${ROOT}/reference`),
    ],
    runEntries: ['readme.md', 'template-session-log.md', 'template.md'],
    journal: doc('readme.md', '# The round journal\n', `${ROOT}/runs`),
    ...overrides,
  };
}

export function repo(...roots: ManualRoot[]): Repo {
  return { roots: roots.length > 0 ? roots : [root()] };
}
