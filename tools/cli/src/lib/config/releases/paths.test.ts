import { expect, test } from 'bun:test';
import path from 'node:path';

import { archive, unpack } from './archive';
import { repoPath, sourcePathSeparators } from './identity';
import { relativePath } from './model';

test('host source paths become canonical POSIX paths only at the host input boundary', () => {
  const native = path.win32.relative(
    'C:\\client',
    'C:\\client\\tale\\clients\\example\\client.json',
  );
  expect(relativePath.parse(sourcePathSeparators(native, '\\'))).toBe(
    'tale/clients/example/client.json',
  );
  expect(sourcePathSeparators('tale/client.json', '\\')).toBe(
    'tale/client.json',
  );
  expect(sourcePathSeparators('tale/client.json', '/')).toBe(
    'tale/client.json',
  );
  expect(() => relativePath.parse(sourcePathSeparators(native, '/'))).toThrow();
  for (const input of [
    '..\\client.json',
    'tale\\..\\client.json',
    'C:\\client.json',
    '\\\\server\\share\\client.json',
    '.\\client.json',
    'tale\\\\client.json',
  ])
    expect(() =>
      relativePath.parse(sourcePathSeparators(input, '\\')),
    ).toThrow();
  expect(
    repoPath(process.cwd(), path.join(process.cwd(), 'tale/client.json')),
  ).toBe('tale/client.json');
});

test('Windows host adaptation never admits backslashes in archive names or changes canonical ZIP bytes', async () => {
  const entries = [
    {
      path: 'tale/client.json',
      bytes: Buffer.from('retained source bytes\n'),
      executable: false,
    },
  ];
  const canonical = await archive(entries);
  const fromWindows = await archive(
    entries.map((entry) => ({
      ...entry,
      path: relativePath.parse(sourcePathSeparators('tale\\client.json', '\\')),
    })),
  );
  expect(fromWindows).toEqual(canonical);
  expect((await unpack(canonical))[0]?.path).toBe('tale/client.json');
  expect(() => relativePath.parse('tale\\client.json')).toThrow();
  await expect(
    archive([{ ...entries[0]!, path: 'tale\\client.json' }]),
  ).rejects.toThrow();
});
