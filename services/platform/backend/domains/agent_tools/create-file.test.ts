// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { CREATE_FILE_MAX_BYTES } from '../../../lib/agent/work-tools.ts';
import { runCreateFile } from './create-file.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';

describe('create_file', () => {
  it('stores a typed-out file and names it in its result', async () => {
    const { scope, stored } = testScope();

    const result = await runCreateFile(scope, {
      name: 'planets.csv',
      content: 'planet,km\nEarth,12756\n',
    });

    expect(stored).toEqual([
      {
        name: 'planets.csv',
        mediaType: 'text/csv',
        text: 'planet,km\nEarth,12756\n',
        size: 22,
      },
    ]);
    expect(result).toMatchObject({
      status: 'ok',
      artifacts: [
        { ref: 's3:acme/out-1', name: 'planets.csv', mediaType: 'text/csv' },
      ],
    });
  });

  it('keeps only the file name of a path', async () => {
    const { scope, stored } = testScope();
    await runCreateFile(scope, { name: '../reports/q3.md', content: '# Q3' });
    expect(stored[0]?.name).toBe('q3.md');
  });

  it.each([
    ['report.pdf', /text formats only/],
    ['deck.pptx', /run_code/],
    ['README', /no extension/],
    ['///', /plain file name/],
  ])('refuses %s with a correctable reason', async (name, reason) => {
    const { scope, stored } = testScope();
    const result = await runCreateFile(scope, { name, content: 'x' });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(JSON.stringify(result)).toMatch(reason);
    expect(stored).toHaveLength(0);
  });

  it('sends a binary format to run_code only where code can run', async () => {
    const { scope } = testScope({
      loadout: { ...FULL_LOADOUT, runCode: false },
    });
    const result = await runCreateFile(scope, {
      name: 'deck.pptx',
      content: 'x',
    });
    expect(result).toMatchObject({ status: 'invalid_args' });
    expect(JSON.stringify(result)).not.toMatch(/run_code/);
  });

  it('refuses empty and oversized content', async () => {
    const { scope, stored } = testScope();
    expect(
      await runCreateFile(scope, { name: 'a.txt', content: '' }),
    ).toMatchObject({ status: 'invalid_args' });
    expect(
      await runCreateFile(scope, {
        name: 'a.txt',
        content: 'x'.repeat(CREATE_FILE_MAX_BYTES + 1),
      }),
    ).toMatchObject({ status: 'invalid_args' });
    expect(stored).toHaveLength(0);
  });

  it('answers malformed arguments without throwing', async () => {
    const { scope } = testScope();
    await expect(runCreateFile(scope, 'nope')).resolves.toMatchObject({
      status: 'invalid_args',
    });
    await expect(
      runCreateFile(scope, { name: 'a.md', content: 7 }),
    ).resolves.toMatchObject({ status: 'invalid_args' });
  });
});
