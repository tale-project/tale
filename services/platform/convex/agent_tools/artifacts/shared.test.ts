import { describe, expect, it } from 'vitest';

import {
  classifyPackages,
  defaultEntryFileFor,
  inferStepLanguage,
  isRunnableArtifactType,
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
