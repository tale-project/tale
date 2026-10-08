// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const { readDirectory, writeManifest } = vi.hoisted(() => ({
  readDirectory: vi.fn(),
  writeManifest: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: readDirectory,
}));

describe('default marketing-image command', () => {
  it.each(['empty', 'missing'] as const)(
    'keeps the required capture manifest when the regular source directory is %s',
    async (state) => {
      vi.resetModules();
      readDirectory.mockReset();
      writeManifest.mockReset();
      if (state === 'empty') readDirectory.mockResolvedValue([]);
      else readDirectory.mockRejectedValue(new Error('ENOENT'));

      const previousArguments = process.argv;
      process.argv = ['bun', 'scripts/optimize-images.ts'];
      vi.stubGlobal('Bun', {
        write: writeManifest,
        $: () => ({ cwd: () => ({ nothrow: async () => ({ exitCode: 0 }) }) }),
      });
      try {
        const { optimizeImages } = await import('./optimize-images');
        expect(readDirectory).not.toHaveBeenCalled();
        await optimizeImages();
        expect(readDirectory).toHaveBeenCalledOnce();
        expect(writeManifest).not.toHaveBeenCalled();
      } finally {
        process.argv = previousArguments;
        vi.unstubAllGlobals();
      }
    },
  );
});
