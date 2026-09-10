import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { temporary } from './tests/fixture';
import { historicalFixture } from './tests/legacy-fixture';

const modulePath = fileURLToPath(new URL('./release.ts', import.meta.url));
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function invoke(
  f: Awaited<ReturnType<typeof historicalFixture>>,
  env: Record<string, string>,
) {
  const options = {
    repoRoot: f.root,
    descriptorPath: f.descriptorPath,
    automationName: f.name,
    manifestPath: f.manifestPath,
    rebuild: true,
  };
  const code = `import { verifyArtifact } from ${JSON.stringify(modulePath)};
try { const release = await verifyArtifact(${JSON.stringify(options)}); console.log(JSON.stringify({sha:release.manifest.artifact.sha256})); }
catch(error) { console.log(JSON.stringify({name:error.constructor.name,message:error.message})); }`;
  return JSON.parse(
    execFileSync(process.execPath, ['-e', code], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    }),
  );
}

test('historical rehydration ignores global attributes, filters and newline configuration', async () => {
  const f = await historicalFixture(2);
  const home = temporary();
  const attributes = path.join(home, 'attributes');
  writeFileSync(attributes, '* text eol=crlf\n');
  writeFileSync(
    path.join(home, '.gitconfig'),
    `[core]\n  autocrlf = true\n  attributesFile = ${attributes.replaceAll('\\', '/')}\n`,
  );
  const result = invoke(f, {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.autocrlf',
    GIT_CONFIG_VALUE_0: 'true',
  });
  expect(result.sha).toBe(f.release.manifest.artifact.sha256);
}, 30_000);

// POSIX shims model the actual old-Apple-Git capability failure and a missing
// Python installation. The portable codecs and error adapter are also exercised
// by every platform's normal source/compiled command suite.
test.skipIf(process.platform === 'win32')(
  'unsupported historical tools have bounded actionable external-dependency errors',
  async () => {
    for (const tool of ['git', 'python3']) {
      const f = await historicalFixture(tool === 'git' ? 1 : 2);
      const bin = path.join(temporary(), 'bin');
      mkdirSync(bin);
      const realGit = Bun.which('git')!;
      writeFileSync(
        path.join(bin, tool),
        tool === 'git'
          ? `#!/bin/sh\nfor arg do if [ "$arg" = archive ]; then exit 42; fi; done\nexec ${shellQuote(realGit)} "$@"\n`
          : '#!/bin/sh\nexit 42\n',
        { mode: 0o755 },
      );
      const result = invoke(f, {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      });
      expect(result.name).toBe('ExternalToolError');
      expect(result.message).toContain(
        tool === 'git' ? 'archive --mtime' : 'Python 3',
      );
      expect(result.message).not.toContain(f.root);
    }
  },
  30_000,
);
