import { describe, expect, it } from 'vitest';

import {
  classifyPackages,
  defaultEntryFileFor,
  detectNodeSpecError,
  detectPythonSpecError,
  inferStepLanguage,
  isRunnableArtifactType,
  refinePackagesObject,
  runnableLanguage,
  runtimesForFiles,
} from './shared';

describe('inferStepLanguage', () => {
  it('maps .py to python', () => {
    expect(inferStepLanguage('main.py')).toBe('python');
    expect(inferStepLanguage('nested/lib/helper.py')).toBe('python');
    expect(inferStepLanguage('MAIN.PY')).toBe('python');
  });

  it('maps .js / .cjs / .mjs to node', () => {
    expect(inferStepLanguage('main.js')).toBe('node');
    expect(inferStepLanguage('legacy.cjs')).toBe('node');
    expect(inferStepLanguage('module.mjs')).toBe('node');
  });

  it('returns null for unknown extensions', () => {
    expect(inferStepLanguage('main.ts')).toBe(null);
    expect(inferStepLanguage('main.rb')).toBe(null);
    expect(inferStepLanguage('README.md')).toBe(null);
    expect(inferStepLanguage('Makefile')).toBe(null);
  });
});

describe('runtimesForFiles', () => {
  it('collects only the runtimes the file set needs', () => {
    expect([...runtimesForFiles(['main.py', 'helper.py'])]).toEqual(['python']);
    expect([...runtimesForFiles(['main.js'])]).toEqual(['node']);
    expect([...runtimesForFiles(['gen.js', 'qa.py'])].sort()).toEqual([
      'node',
      'python',
    ]);
  });

  it('skips unknown extensions silently — caller is expected to reject', () => {
    expect([...runtimesForFiles(['main.py', 'extra.rb'])]).toEqual(['python']);
  });
});

describe('isRunnableArtifactType', () => {
  it('includes script_runnable and legacy literals', () => {
    expect(isRunnableArtifactType('script_runnable')).toBe(true);
    expect(isRunnableArtifactType('python_runnable')).toBe(true);
    expect(isRunnableArtifactType('node_runnable')).toBe(true);
  });

  it('excludes static types', () => {
    expect(isRunnableArtifactType('code')).toBe(false);
    expect(isRunnableArtifactType('html')).toBe(false);
  });
});

describe('runnableLanguage (legacy single-runtime helper)', () => {
  it('returns the locked language for legacy literals', () => {
    expect(runnableLanguage('python_runnable')).toBe('python');
    expect(runnableLanguage('node_runnable')).toBe('node');
  });

  it('returns null for script_runnable (polyglot — per-file)', () => {
    expect(runnableLanguage('script_runnable')).toBe(null);
  });
});

describe('classifyPackages', () => {
  it('strips python: prefix and routes to the python bucket', () => {
    expect(
      classifyPackages(['python:markitdown[pptx]', 'pptxgenjs'], 'node'),
    ).toEqual({
      python: ['markitdown[pptx]'],
      node: ['pptxgenjs'],
    });
  });

  it('strips node: / npm: prefix and routes to the node bucket', () => {
    expect(
      classifyPackages(['numpy', 'node:lodash', 'npm:axios'], 'python'),
    ).toEqual({
      python: ['numpy'],
      node: ['lodash', 'axios'],
    });
  });

  it('treats pip: as a python alias', () => {
    expect(classifyPackages(['pip:requests==2.31.0'], 'node')).toEqual({
      python: ['requests==2.31.0'],
      node: [],
    });
  });

  it('routes bare specs to defaultLang', () => {
    expect(classifyPackages(['numpy', 'pandas'], 'python')).toEqual({
      python: ['numpy', 'pandas'],
      node: [],
    });
    expect(classifyPackages(['lodash', 'axios'], 'node')).toEqual({
      python: [],
      node: ['lodash', 'axios'],
    });
  });

  it('falls back to python when defaultLang is null', () => {
    expect(classifyPackages(['numpy'], null)).toEqual({
      python: ['numpy'],
      node: [],
    });
  });

  it('is case-insensitive on the prefix', () => {
    expect(classifyPackages(['PYTHON:numpy', 'Node:lodash'], 'python')).toEqual(
      {
        python: ['numpy'],
        node: ['lodash'],
      },
    );
  });

  it('skips empty / whitespace-only specs', () => {
    expect(classifyPackages(['', '  ', 'numpy'], 'python')).toEqual({
      python: ['numpy'],
      node: [],
    });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(
      classifyPackages(['  python:numpy  ', '  lodash  '], 'node'),
    ).toEqual({
      python: ['numpy'],
      node: ['lodash'],
    });
  });
});

describe('defaultEntryFileFor', () => {
  it('uses main.py by default for script_runnable', () => {
    expect(defaultEntryFileFor('script_runnable')).toBe('main.py');
  });

  it('switches to main.js when the language hint is node-flavored', () => {
    expect(defaultEntryFileFor('script_runnable', 'javascript')).toBe(
      'main.js',
    );
    expect(defaultEntryFileFor('script_runnable', 'js')).toBe('main.js');
    expect(defaultEntryFileFor('script_runnable', 'node')).toBe('main.js');
  });

  it('preserves the legacy entry-file defaults', () => {
    expect(defaultEntryFileFor('python_runnable')).toBe('main.py');
    expect(defaultEntryFileFor('node_runnable')).toBe('main.js');
  });
});

describe('detectPythonSpecError', () => {
  it('rejects npm version pin (pkg@version)', () => {
    expect(detectPythonSpecError('pptxgenjs@3.12.0')).toMatch(
      /npm version pin.*packages\.node/,
    );
    expect(detectPythonSpecError('lodash@^4.0')).toMatch(/packages\.node/);
  });

  it('rejects npm scoped packages', () => {
    expect(detectPythonSpecError('@anthropic/sdk')).toMatch(
      /npm scope.*packages\.node/,
    );
    expect(detectPythonSpecError('@scope/pkg@1.0.0')).toMatch(/packages\.node/);
  });

  it('rejects npm range operators at start', () => {
    expect(detectPythonSpecError('^1.0.0')).toMatch(/range operator/);
    expect(detectPythonSpecError('~2.3')).toMatch(/range operator/);
  });

  it('passes pip-canonical specs', () => {
    expect(detectPythonSpecError('numpy')).toBe(null);
    expect(detectPythonSpecError('requests==2.31.0')).toBe(null);
    expect(detectPythonSpecError('markitdown[pptx]')).toBe(null);
    expect(detectPythonSpecError('pkg @ git+https://example.com/repo')).toBe(
      null,
    );
  });
});

describe('detectNodeSpecError', () => {
  it('rejects pip extras syntax', () => {
    expect(detectNodeSpecError('markitdown[pptx]')).toMatch(
      /pip extras.*packages\.python/,
    );
  });

  it('rejects pip PEP 440 version operators', () => {
    expect(detectNodeSpecError('requests==2.31.0')).toMatch(
      /PEP 440.*packages\.python/,
    );
    expect(detectNodeSpecError('pkg~=1.0')).toMatch(/packages\.python/);
    expect(detectNodeSpecError('pkg!=1.0')).toMatch(/packages\.python/);
  });

  it('rejects pip direct-URL form (whitespace around @)', () => {
    expect(detectNodeSpecError('pkg @ https://example.com/pkg.tar.gz')).toMatch(
      /direct-URL.*packages\.python/,
    );
  });

  it('passes npm-canonical specs', () => {
    expect(detectNodeSpecError('pptxgenjs')).toBe(null);
    expect(detectNodeSpecError('pptxgenjs@3.12.0')).toBe(null);
    expect(detectNodeSpecError('@anthropic/sdk')).toBe(null);
    expect(detectNodeSpecError('lodash@^4.0.0')).toBe(null);
  });
});

describe('refinePackagesObject', () => {
  it('emits one issue per bad spec, scoped to its bucket index', () => {
    const issues: Array<{
      code: 'custom';
      path: (string | number)[];
      message: string;
    }> = [];
    refinePackagesObject(
      {
        python: ['numpy', 'pptxgenjs@3.12.0', '@scope/x'],
        node: ['lodash', 'markitdown[pptx]'],
      },
      (issue) => issues.push(issue),
    );
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatchObject({ path: ['python', 1] });
    expect(issues[0]?.message).toMatch(/packages\.node/);
    expect(issues[1]).toMatchObject({ path: ['python', 2] });
    expect(issues[2]).toMatchObject({ path: ['node', 1] });
    expect(issues[2]?.message).toMatch(/packages\.python/);
  });

  it('is a no-op when packages is undefined or all-canonical', () => {
    const issues: unknown[] = [];
    refinePackagesObject(undefined, () => issues.push('x'));
    refinePackagesObject(
      { python: ['numpy', 'requests==2.31.0'], node: ['lodash@^4.0.0'] },
      () => issues.push('x'),
    );
    expect(issues).toHaveLength(0);
  });
});
