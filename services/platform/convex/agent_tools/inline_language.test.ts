// The inline run_code pre-flight: LANGUAGE_MISMATCH scoring (per-declared-
// language signal tables over literal-stripped code) and PREFER_PACKAGES
// install detection. The false-positive cases matter as much as the true
// positives — the validator is fail-open by contract.

import { describe, expect, it } from 'vitest';

import { stripLiterals, validateInlineCode } from './inline_language';

describe('stripLiterals', () => {
  it('blanks quoted strings so their content cannot score', () => {
    const out = stripLiterals('echo "import os" > /user/output/x.py', 'bash');
    expect(out).not.toContain('import os');
  });

  it('blanks bash heredoc bodies', () => {
    const code = 'python3 <<EOF\nimport os\nprint(os.getcwd())\nEOF\necho ok';
    const out = stripLiterals(code, 'bash');
    expect(out).not.toContain('import os');
    expect(out).toContain('echo ok');
  });

  it('strips comments but keeps the shebang line', () => {
    const out = stripLiterals('#!/bin/bash\n# import os\nls', 'bash');
    expect(out).toContain('#!/bin/bash');
    expect(out).not.toContain('import os');
  });

  it('strips node line comments without eating URLs', () => {
    const out = stripLiterals(
      "const u = 'https://x.test' // import os\n",
      'node',
    );
    expect(out).toContain('const u =');
    expect(out).not.toContain('import os');
  });
});

describe('validateInlineCode — LANGUAGE_MISMATCH', () => {
  it('rejects Python source declared as bash (the classic failure)', () => {
    const issue = validateInlineCode('import os\nprint(os.getcwd())', 'bash');
    expect(issue?.code).toBe('LANGUAGE_MISMATCH');
    expect(issue?.message).toContain('looks like python');
    expect(issue?.message).toContain('resubmit with language: "python"');
  });

  it('rejects a Python def declared as node', () => {
    const issue = validateInlineCode(
      'def main():\n    return 1\nmain()',
      'node',
    );
    expect(issue?.code).toBe('LANGUAGE_MISMATCH');
  });

  it('rejects JS declared as python', () => {
    const issue = validateInlineCode(
      "const fs = require('node:fs')\nconsole.log(fs.readdirSync('.'))",
      'python',
    );
    expect(issue?.code).toBe('LANGUAGE_MISMATCH');
    expect(issue?.message).toContain('looks like node');
  });

  it('rejects a shell script declared as python', () => {
    const issue = validateInlineCode(
      '#!/bin/bash\nfor f in *.txt; do\n  echo "$f"\ndone',
      'python',
    );
    expect(issue?.code).toBe('LANGUAGE_MISMATCH');
    expect(issue?.message).toContain('looks like bash');
  });

  it('never auto-corrects: the verdict only names the suspected language', () => {
    const issue = validateInlineCode('import os\nprint(1)', 'bash');
    expect(issue?.message).toContain('not auto-corrected');
  });

  it.each([
    ['plain bash', 'ls -la /user/output && du -sh /user/uploads', 'bash'],
    [
      'bash driving python via heredoc',
      'python3 <<EOF\nimport os\nprint(1)\nEOF',
      'bash',
    ],
    [
      'bash echoing python source',
      'echo "import os" > /user/output/gen.py',
      'bash',
    ],
    ['bash pipeline', 'cat data.csv | grep -v "^#" | sort | head -5', 'bash'],
    [
      'python with strings full of shell',
      'import subprocess\nsubprocess.run(["ls", "-la"])',
      'python',
    ],
    [
      'node ESM',
      "import fs from 'node:fs'\nconst names = fs.readdirSync('/user/output')\nconsole.log(names)",
      'node',
    ],
    ['python one-liner', 'print(sum(range(10)))', 'python'],
    ['bash with a single weak signal', 'print_report --format=json', 'bash'],
  ] as const)('fails open on %s', (_label, code, language) => {
    expect(validateInlineCode(code, language)).toBeNull();
  });
});

describe('validateInlineCode — PREFER_PACKAGES', () => {
  it.each([
    ['bash pip install', 'pip install pandas', 'bash'],
    [
      'bash pip3 with chained run',
      'pip3 install requests && python3 x.py',
      'bash',
    ],
    ['python -m pip', 'python3 -m pip install numpy', 'bash'],
    ['pip install typed as python', 'pip install pandas', 'python'],
    ['npm global install', 'npm install -g typescript', 'bash'],
    ['npm i --global', 'npm i --global sharp', 'bash'],
    [
      'python subprocess pip',
      "import subprocess, sys\nsubprocess.run([sys.executable, '-m', 'pip', 'install', 'foo'])",
      'python',
    ],
    [
      'node execSync npm -g',
      "const { execSync } = require('node:child_process')\nexecSync('npm install -g sharp')",
      'node',
    ],
  ] as const)(
    'routes %s to the packages parameter',
    (_label, code, language) => {
      const issue = validateInlineCode(code, language);
      expect(issue?.code).toBe('PREFER_PACKAGES');
      expect(issue?.message).toContain('`packages` parameter');
    },
  );

  it.each([
    ['requirements file', 'pip install -r requirements.txt', 'bash'],
    ['editable install', 'pip install -e .', 'bash'],
    ['local dir install', 'pip install .', 'bash'],
    [
      'project-local npm install',
      'cd /user/code && npm install && node index.mjs',
      'bash',
    ],
    ['quoted mention only', 'echo "run pip install pandas yourself"', 'bash'],
    [
      'commented mention next to a spawn',
      'import subprocess\n# TODO: pip install later\nsubprocess.run(["ls"])',
      'python',
    ],
  ] as const)('keeps %s allowed', (_label, code, language) => {
    expect(validateInlineCode(code, language)).toBeNull();
  });
});
