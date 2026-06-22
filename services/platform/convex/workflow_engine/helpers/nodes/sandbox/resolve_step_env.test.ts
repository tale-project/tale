import { describe, expect, it } from 'vitest';

import { resolveStepEnv } from './resolve_step_env';

describe('resolveStepEnv', () => {
  it('returns an empty map when no env is declared', () => {
    expect(resolveStepEnv(undefined, {})).toEqual({});
    expect(resolveStepEnv({}, { anything: 1 })).toEqual({});
  });

  it('passes through literal (non-templated) values verbatim', () => {
    expect(resolveStepEnv({ NODE_ENV: 'production' }, {})).toEqual({
      NODE_ENV: 'production',
    });
  });

  it('resolves a decrypted workflow secret via {{secrets.X}}', () => {
    const env = { OPENAI_API_KEY: '{{secrets.OPENAI_API_KEY}}' };
    const variables = { secrets: { OPENAI_API_KEY: 'sk-live-123' } };
    expect(resolveStepEnv(env, variables)).toEqual({
      OPENAI_API_KEY: 'sk-live-123',
    });
  });

  it('resolves a runtime value and coerces non-strings to strings', () => {
    const env = { TASK_ID: '{{input.task._id}}', ATTEMPT: '{{run.attempt}}' };
    const variables = {
      input: { task: { _id: 'task_42' } },
      run: { attempt: 3 },
    };
    expect(resolveStepEnv(env, variables)).toEqual({
      TASK_ID: 'task_42',
      ATTEMPT: '3',
    });
  });

  it('supports mixed literal + template content in one value', () => {
    const env = {
      REPO_URL: 'https://github.com/{{input.owner}}/{{input.repo}}',
    };
    const variables = { input: { owner: 'tale-project', repo: 'tale' } };
    expect(resolveStepEnv(env, variables)).toEqual({
      REPO_URL: 'https://github.com/tale-project/tale',
    });
  });

  it('skips (does not inject) a value whose template fails to resolve', () => {
    const env = {
      GOOD: 'literal',
      BAD: '{{secrets.MISSING}}',
    };
    const resolved = resolveStepEnv(env, { secrets: {} });
    expect(resolved.GOOD).toBe('literal');
    expect('BAD' in resolved).toBe(false);
  });
});
