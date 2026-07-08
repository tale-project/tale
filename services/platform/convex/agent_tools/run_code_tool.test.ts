// run_code arg schema (mode-discriminated union with strict variants), the
// provider-facing flatten contract, the package policy gate, and the
// terminal-output result message. Pure zod + string formatting — the only
// mock is createTool so importing the tool module doesn't pull the agent
// runtime.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def: unknown) => def),
}));

import type { RunCodePolicyConfig } from '../../lib/shared/schemas/governance';
import { flattenUnionSchema } from '../providers/resolve_model';
import {
  checkPackagesAgainstPolicy,
  formatRunCodeResultMessage,
  runCodeArgs,
} from './run_code_tool';

describe('runCodeArgs', () => {
  it('accepts each mode', () => {
    expect(
      runCodeArgs.safeParse({ mode: 'script', entryPath: '/user/code/a.py' })
        .success,
    ).toBe(true);
    expect(
      runCodeArgs.safeParse({
        mode: 'inline',
        code: 'print(1)',
        language: 'python',
      }).success,
    ).toBe(true);
    expect(
      runCodeArgs.safeParse({
        mode: 'install',
        packages: { python: ['pandas'] },
      }).success,
    ).toBe(true);
  });

  it('accepts packages as an adjunct on script and inline', () => {
    expect(
      runCodeArgs.safeParse({
        mode: 'script',
        entryPath: '/user/code/a.py',
        packages: { python: ['pandas'], node: ['sharp'] },
      }).success,
    ).toBe(true);
    expect(
      runCodeArgs.safeParse({
        mode: 'inline',
        code: 'import pandas',
        language: 'python',
        packages: { python: ['pandas'] },
      }).success,
    ).toBe(true);
  });

  it('rejects a missing mode with all three examples', () => {
    const res = runCodeArgs.safeParse({ entryPath: '/user/code/a.py' });
    expect(res.success).toBe(false);
    if (!res.success) {
      const text = res.error.issues.map((i) => i.message).join('\n');
      expect(text).toContain('"script"');
      expect(text).toContain('"inline"');
      expect(text).toContain('"install"');
      expect(text).toContain('entryPath');
    }
  });

  it('rejects cross-mode fields instead of silently stripping them', () => {
    // The flattened provider schema advertises every field on every mode, so
    // this combination WILL arrive. Non-strict variants would drop `code` and
    // run something else than the model asked for.
    const res = runCodeArgs.safeParse({
      mode: 'script',
      entryPath: '/user/code/a.py',
      code: 'print(1)',
      language: 'python',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.code === 'unrecognized_keys')).toBe(
        true,
      );
    }
    expect(
      runCodeArgs.safeParse({
        mode: 'inline',
        code: 'print(1)',
        language: 'python',
        entryPath: '/user/code/a.py',
      }).success,
    ).toBe(false);
  });

  it('rejects the removed steps array', () => {
    expect(
      runCodeArgs.safeParse({
        mode: 'script',
        entryPath: '/user/code/a.py',
        steps: [{ path: '/user/code/b.py' }],
      }).success,
    ).toBe(false);
    expect(
      runCodeArgs.safeParse({ steps: [{ path: '/user/code/b.py' }] }).success,
    ).toBe(false);
  });

  it('requires language with inline code', () => {
    expect(
      runCodeArgs.safeParse({ mode: 'inline', code: 'print(1)' }).success,
    ).toBe(false);
  });

  it('requires at least one non-empty package bucket for install', () => {
    expect(
      runCodeArgs.safeParse({ mode: 'install', packages: {} }).success,
    ).toBe(false);
    expect(
      runCodeArgs.safeParse({ mode: 'install', packages: { python: [] } })
        .success,
    ).toBe(false);
    expect(runCodeArgs.safeParse({ mode: 'install' }).success).toBe(false);
  });

  it('keeps the per-spec packages refinement', () => {
    expect(
      runCodeArgs.safeParse({
        mode: 'install',
        packages: { python: [''] },
      }).success,
    ).toBe(false);
    expect(
      runCodeArgs.safeParse({
        mode: 'install',
        packages: { python: ['python:pandas'] },
      }).success,
    ).toBe(false);
  });
});

describe('provider schema flatten (OpenAI oneOf workaround)', () => {
  it('flattens to a single object keeping mode as the only required field', () => {
    const json = z.toJSONSchema(runCodeArgs, { io: 'input' }) as Record<
      string,
      unknown
    >;
    // The union must surface at the root for the middleware to fire.
    expect(json.oneOf ?? json.anyOf).toBeDefined();

    const flat = flattenUnionSchema(json);
    expect(flat.type).toBe('object');
    expect(flat.required).toEqual(['mode']);
    expect(flat.additionalProperties).toBe(false);

    const properties = flat.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'mode',
        'entryPath',
        'code',
        'language',
        'packages',
        'timeoutMs',
      ]),
    );
    expect(properties.mode.enum).toEqual(['script', 'inline', 'install']);
  });
});

describe('checkPackagesAgainstPolicy', () => {
  const policy = (over: Partial<RunCodePolicyConfig>): RunCodePolicyConfig => ({
    defaultMode: 'denylist',
    pythonAllow: [],
    pythonDeny: [],
    nodeAllow: [],
    nodeDeny: [],
    ...over,
  });

  it('allows everything without a policy', () => {
    expect(checkPackagesAgainstPolicy(null, { python: ['anything'] }).ok).toBe(
      true,
    );
  });

  it('blocks denied python packages', () => {
    const res = checkPackagesAgainstPolicy(
      policy({ pythonDeny: ['requests'] }),
      { python: ['requests'] },
    );
    expect(res.ok).toBe(false);
  });

  it('blocks denied node packages (both buckets are checked)', () => {
    // Regression: the node bucket used to be skipped entirely.
    const res = checkPackagesAgainstPolicy(policy({ nodeDeny: ['sharp'] }), {
      python: ['pandas'],
      node: ['sharp'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.package).toBe('sharp');
      expect(res.message).toContain('node package "sharp"');
    }
  });

  it('enforces the allowlist on the node bucket', () => {
    const res = checkPackagesAgainstPolicy(
      policy({ defaultMode: 'allowlist', pythonAllow: ['pandas'] }),
      { python: ['pandas'], node: ['left-pad'] },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('not on the org allowlist');
  });

  it('lets deny win over allow in allowlist mode', () => {
    const res = checkPackagesAgainstPolicy(
      policy({
        defaultMode: 'allowlist',
        pythonAllow: ['requests'],
        pythonDeny: ['requests'],
      }),
      { python: ['requests'] },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('explicitly denied');
  });

  it('matches case-insensitively on the version-stripped base name', () => {
    const res = checkPackagesAgainstPolicy(policy({ pythonDeny: ['pandas'] }), {
      python: ['Pandas==2.2.1'],
    });
    expect(res.ok).toBe(false);

    const allowed = checkPackagesAgainstPolicy(
      policy({ defaultMode: 'allowlist', pythonAllow: ['python-pptx'] }),
      { python: ['python-pptx>=1.0'] },
    );
    expect(allowed.ok).toBe(true);
  });
});

const baseRun = {
  status: 'completed' as const,
  exitCode: 0,
  stdoutPreview: '',
  stderrPreview: '',
  durationMs: 42,
  files: [] as Array<{ path: string }>,
};

describe('formatRunCodeResultMessage', () => {
  it('embeds stdout as a fenced terminal block', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'total 0\ndrwxr-xr-x output\n',
    });
    expect(msg).toContain('stdout:\n```\ntotal 0\ndrwxr-xr-x output\n```');
    // Short note replaces the long harvest lecture when there IS output.
    expect(msg).not.toContain('Wrong (file is lost');
  });

  it('keeps the harvest hint only when the run produced nothing at all', () => {
    const msg = formatRunCodeResultMessage(baseRun);
    expect(msg).toContain('nothing was printed');
    expect(msg).toContain('/user/output/');
  });

  it('lists harvested files and still appends stdout', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      files: [{ path: '/user/output/report.pdf' }],
      stdoutPreview: 'wrote report\n',
    });
    expect(msg).toContain('/user/output/report.pdf');
    expect(msg).toContain('stdout:');
  });

  it('shows stderr only on failure', () => {
    const ok = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'fine\n',
      stderrPreview: 'pip install noise\n',
    });
    expect(ok).not.toContain('stderr:');

    const failed = formatRunCodeResultMessage({
      ...baseRun,
      status: 'failed',
      exitCode: 1,
      errorCode: 'RUNTIME_ERROR',
      errorMessage: 'boom',
      stderrPreview: 'Traceback: boom\n',
    });
    expect(failed).toContain('run_code FAILED: RUNTIME_ERROR — boom');
    expect(failed).toContain('stderr:\n```\nTraceback: boom\n```');
  });

  it('widens the fence when the output itself contains ```', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      stdoutPreview: 'a\n```\nb\n',
    });
    expect(msg).toContain('````\na\n```\nb\n````');
  });

  it('reports an install-only success without the harvest lecture', () => {
    const msg = formatRunCodeResultMessage(
      { ...baseRun, stdoutPreview: 'Successfully installed pandas-2.2.1\n' },
      { installOnly: true, packageCount: 2 },
    );
    expect(msg).toContain('run_code installed 2 package(s) in 42ms');
    expect(msg).toContain('persist for later run_code calls in this turn');
    expect(msg).toContain('Successfully installed pandas-2.2.1');
    expect(msg).not.toContain('nothing was printed');
  });

  it('surfaces INSTALL_FAILED with the installer output', () => {
    const msg = formatRunCodeResultMessage(
      {
        ...baseRun,
        status: 'failed',
        exitCode: 1,
        errorCode: 'INSTALL_FAILED',
        errorMessage: 'pip install failed (exit 1)',
        stderrPreview: 'ERROR: No matching distribution found for nope\n',
      },
      { installOnly: true, packageCount: 1 },
    );
    expect(msg).toContain('run_code FAILED: INSTALL_FAILED');
    expect(msg).toContain('pip install failed (exit 1)');
    expect(msg).toContain('No matching distribution');
  });

  it('appends the language hint when bash choked on Python source', () => {
    const msg = formatRunCodeResultMessage({
      ...baseRun,
      status: 'failed',
      exitCode: 127,
      stderrPreview: 'line 1: import: command not found\n',
    });
    expect(msg).toContain('Resubmit with `language` matching the code');
  });
});
