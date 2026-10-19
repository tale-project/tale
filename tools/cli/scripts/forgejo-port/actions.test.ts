import { describe, expect, test } from 'bun:test';

import {
  ACTIONS,
  DOWNLOAD_ARTIFACT,
  UPLOAD_ARTIFACT,
  externalActions,
  registryLogin,
  replaceText,
  rewriteActions,
  rewriteLocalActions,
} from './actions';
import { portWorkflow } from './port';
import { emptyReport, readWorkflow } from './workflow';

const SHA = 'a'.repeat(40);

function run(source: string, rules: Parameters<typeof portWorkflow>[3]) {
  const report = emptyReport();
  const result = portWorkflow(source, 'w.yml', report, rules);
  return { ...result, report };
}

const wf = (steps: string, extra = '') => `name: W
on:
  pull_request:
${extra}jobs:
  a:
    runs-on: ubuntu-latest
    steps:
${steps}`;

describe('the action table', () => {
  test('pins the Forgejo artifact forks by full commit', () => {
    expect(UPLOAD_ARTIFACT.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(DOWNLOAD_ARTIFACT.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(ACTIONS.get('forgejo/upload-artifact')).toEqual({ kind: 'keep' });
    expect(ACTIONS.get('actions/upload-artifact')).toEqual({
      kind: 'replace',
      to: UPLOAD_ARTIFACT,
    });
  });

  test('knows every external action Tale uses today', () => {
    // every external action the workflows used when the table was written
    for (const name of [
      'actions/checkout',
      'actions/upload-artifact',
      'actions/download-artifact',
      'actions/cache',
      'actions/cache/restore',
      'actions/cache/save',
      'actions/setup-node',
      'actions/github-script',
      'oven-sh/setup-bun',
      'astral-sh/setup-uv',
      'docker/setup-buildx-action',
      'docker/build-push-action',
      'docker/bake-action',
      'docker/login-action',
      'aquasecurity/trivy-action',
      'dorny/paths-filter',
      'github/codeql-action/upload-sarif',
      'ossf/scorecard-action',
    ])
      expect(ACTIONS.has(name), name).toBe(true);
  });
});

describe('rewriteActions', () => {
  test('uses the artifact forks and says why, keeping the pin comment honest', () => {
    const { text, report } = run(
      wf(`      - uses: actions/upload-artifact@${SHA} # v7
        with:
          name: x
      - uses: actions/download-artifact@${SHA} # v8
        with:
          name: x
`),
      { rules: [rewriteActions] },
    );
    expect(text).toContain(
      `uses: forgejo/upload-artifact@${UPLOAD_ARTIFACT.sha} # v5, patched for Forgejo`,
    );
    expect(text).toContain(
      `uses: forgejo/download-artifact@${DOWNLOAD_ARTIFACT.sha} # v7, patched for Forgejo`,
    );
    expect(
      report.changes.filter((change) => change.rule === 'action-replaced'),
    ).toHaveLength(2);
  });

  test('removes cache steps and what they said, so a save that waited for a miss goes too', () => {
    const { text } = run(
      wf(`      - id: bun-cache
        uses: actions/cache/restore@${SHA} # v5
        with:
          path: ~/.bun
          key: k
      - run: echo install
      - if: steps.bun-cache.outputs.cache-hit != 'true'
        uses: actions/cache/save@${SHA} # v5
        with:
          path: ~/.bun
          key: k
      - if: steps.bun-cache.outputs.cache-hit == 'true'
        run: echo hit
`),
      { rules: [rewriteActions] },
    );
    expect(text).not.toContain('actions/cache');
    expect(text).toContain('echo install');
    expect(text).not.toContain('echo hit');
    expect(text).not.toContain('cache-hit');
  });

  test('keeps the cache facts of one job inside that job', () => {
    const { text } = run(
      `name: W
on:
  pull_request:
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - id: cache
        uses: actions/cache@${SHA}
      - if: steps.cache.outputs.cache-hit == 'true'
        run: echo a-hit
  b:
    runs-on: ubuntu-latest
    steps:
      - id: cache
        run: echo make
      - if: steps.cache.outputs.cache-hit == 'true'
        run: echo b-hit
`,
      { rules: [rewriteActions] },
    );
    expect(text).not.toContain('a-hit');
    expect(text).toContain('b-hit');
  });

  test('removes the SARIF upload', () => {
    const { text } = run(
      wf(`      - uses: github/codeql-action/upload-sarif@${SHA} # v4
        with:
          sarif_file: x.sarif
      - run: echo done
`),
      { rules: [rewriteActions] },
    );
    expect(text).not.toContain('codeql');
    expect(text).toContain('echo done');
  });

  test('warns about an action it does not know and about one that cannot work', () => {
    const { report, text } = run(
      wf(`      - uses: someone/new-action@${SHA}
      - uses: actions/github-script@${SHA}
        with:
          script: return 1
`),
      { rules: [rewriteActions] },
    );
    expect(report.warnings.map((warning) => warning.rule).sort()).toEqual([
      'action-unportable',
      'unknown-action',
    ]);
    expect(text).toContain('someone/new-action');
  });

  test('leaves local and docker steps to their own rules', () => {
    const { report } = run(
      wf(`      - uses: ./.github/actions/x
      - uses: docker://alpine:3
`),
      { rules: [rewriteActions] },
    );
    expect(report.warnings).toEqual([]);
  });
});

describe('rewriteLocalActions', () => {
  const rule = rewriteLocalActions({
    composites: ['setup-turbo'],
    scripts: [],
  });

  test('uses the Forgejo copy of a ported composite and flags one that is GitHub-only', () => {
    const { text, report } = run(
      wf(`      - uses: ./.github/actions/setup-turbo
      - uses: ./.github/actions/ci-scope
`),
      { rules: [rule] },
    );
    expect(text).toContain('uses: ./.forgejo/actions/setup-turbo');
    expect(text).toContain('uses: ./.github/actions/ci-scope');
    expect(report.warnings.map((warning) => warning.rule)).toEqual([
      'local-action-unported',
    ]);
  });
});

describe('registryLogin', () => {
  test('logs in to Forgejo with the package token, and names the registry', () => {
    const { text } = run(
      `name: B
on:
  pull_request:
env:
  REGISTRY: ghcr.io
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/login-action@${SHA} # v4
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/login-action@${SHA} # v4
        with:
          registry: docker.io
          username: me
          password: \${{ secrets.HUB }}
`,
      {
        rules: [
          registryLogin({
            host: 'git.tale.dev',
            tokenSecret: 'CI_PACKAGES_TOKEN',
          }),
        ],
      },
    );
    expect(text).toContain('REGISTRY: git.tale.dev');
    expect(text).toContain('password: ${{ secrets.CI_PACKAGES_TOKEN }}');
    expect(text).toContain('password: ${{ secrets.HUB }}');
  });
});

describe('externalActions and replaceText', () => {
  test('lists the actions a document uses, with the refs it pins', () => {
    const doc = readWorkflow(
      wf(`      - uses: actions/checkout@${SHA}
      - uses: ./.github/actions/x
      - uses: docker://alpine:3
`),
      'w.yml',
    );
    expect(externalActions(doc)).toEqual([
      { name: 'actions/checkout', ref: SHA },
    ]);
  });

  test('replaces text everywhere, and counts the strings it changed', () => {
    const doc = readWorkflow(
      wf(
        '      - run: bash .github/scripts/x.sh && echo .github/scripts/x.sh\n',
      ),
      'w.yml',
    );
    expect(
      replaceText(doc, '.github/scripts/x.sh', '.forgejo/scripts/x.sh'),
    ).toBe(1);
    expect(replaceText(doc, 'nothing here', 'x')).toBe(0);
    expect(doc.toString()).toContain(
      'bash .forgejo/scripts/x.sh && echo .forgejo/scripts/x.sh',
    );
  });
});
