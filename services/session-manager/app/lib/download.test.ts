import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadJson } from './download';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadJson', () => {
  it('downloads the data as an indented JSON file and releases the address', async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) created.push(blob);
      return 'blob:test';
    });
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    let clicked: { href: string; download: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked = { href: this.href, download: this.download };
      },
    );

    downloadJson('proxy.json', { a: [1] });

    expect(clicked).toEqual({ href: 'blob:test', download: 'proxy.json' });
    expect(await created[0]?.text()).toBe('{\n  "a": [\n    1\n  ]\n}\n');
    expect(created[0]?.type).toBe('application/json');
    expect(revoke).toHaveBeenCalledWith('blob:test');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
