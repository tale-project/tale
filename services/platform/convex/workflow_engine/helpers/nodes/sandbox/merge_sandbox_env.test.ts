import { describe, expect, it } from 'vitest';

import { mergeSandboxEnv } from './merge_sandbox_env';

describe('mergeSandboxEnv', () => {
  it('returns an empty map when every layer is empty', () => {
    expect(mergeSandboxEnv({}, {}, {})).toEqual({});
  });

  it('unions disjoint keys across all three layers', () => {
    expect(
      mergeSandboxEnv(
        { WORKFLOW_ONLY: 'w' },
        { FILE_ONLY: 'f' },
        { STEP_ONLY: 's' },
      ),
    ).toEqual({ WORKFLOW_ONLY: 'w', FILE_ONLY: 'f', STEP_ONLY: 's' });
  });

  it('lets a step value override a workflow value on the same key', () => {
    expect(
      mergeSandboxEnv({ API_BASE: 'workflow' }, {}, { API_BASE: 'step' }),
    ).toEqual({ API_BASE: 'step' });
  });

  it('lets the file config.env override a workflow value', () => {
    expect(
      mergeSandboxEnv({ NODE_ENV: 'workflow' }, { NODE_ENV: 'file' }, {}),
    ).toEqual({ NODE_ENV: 'file' });
  });

  it('lets the step side-table override the file config.env (operator wins)', () => {
    expect(
      mergeSandboxEnv({}, { TOKEN: 'file' }, { TOKEN: 'operator' }),
    ).toEqual({ TOKEN: 'operator' });
  });

  it('applies the full precedence chain workflow < file < step', () => {
    expect(
      mergeSandboxEnv({ K: 'workflow' }, { K: 'file' }, { K: 'step' }),
    ).toEqual({ K: 'step' });
  });
});
