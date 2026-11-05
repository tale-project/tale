import { describe, expect, it } from 'vitest';

import { isStorageRef, withoutStorageRefs } from './stored-files-context';

describe('a copied reply without the stored-file references its text names [CHAT-R40]', () => {
  it('drops a picture of a stored file and keeps a link’s words', () => {
    expect(
      withoutStorageRefs(
        'Here is the table: ![planets.csv](s3:acme/0f3c)\n\nOpen [planets.csv](s3:acme/0f3c) to read it, or see [the docs](https://docs.tale.dev).',
      ),
    ).toBe(
      'Here is the table: \n\nOpen planets.csv to read it, or see [the docs](https://docs.tale.dev).',
    );
  });

  it('knows a stored-file reference from any other address', () => {
    expect(isStorageRef('s3:acme/0f3c')).toBe(true);
    expect(isStorageRef('s3:')).toBe(false);
    expect(isStorageRef('https://example.com')).toBe(false);
    expect(isStorageRef(undefined)).toBe(false);
  });
});
