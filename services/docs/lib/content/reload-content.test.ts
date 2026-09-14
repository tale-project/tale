import type { EnvironmentModuleNode } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { reloadDocsContent } from './reload-content';

describe('docs content updates', () => {
  function run(file: string, environmentName = 'client') {
    const plugin = reloadDocsContent(
      '/repo/docs',
      '/repo/services/docs/app/content/frontmatter.json',
    );
    const send = vi.fn();
    const invalidateModule = vi.fn();
    const module = { id: file } as EnvironmentModuleNode;
    // Only the hook's Vite environment surface is needed in this fixture.
    const context = {
      environment: {
        name: environmentName,
        hot: { send },
        moduleGraph: { invalidateModule },
      },
    } as unknown as ThisParameterType<typeof plugin.hotUpdate>;
    const options = { file, modules: [module], timestamp: 123 } as Parameters<
      typeof plugin.hotUpdate
    >[0];
    const result = plugin.hotUpdate.call(context, options);
    return { result, send, invalidateModule, module };
  }

  it.each([
    '/repo/docs/en/platform/chat/attachments.md',
    '/repo/docs/fr/get-started/quickstart.md',
    '/repo/docs/nav.json',
    '/repo/services/docs/app/content/frontmatter.json',
  ])(
    'loads a fresh route for %s instead of refreshing an empty body cache',
    (file) => {
      const { result, send, invalidateModule, module } = run(file);
      expect(invalidateModule).toHaveBeenCalledWith(
        module,
        expect.any(Set),
        123,
        true,
      );
      expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
      expect(result).toEqual([]);
    },
  );

  it.each([
    '/repo/services/docs/app/pages/docs-page.tsx',
    '/repo/docs-other/example.md',
  ])('preserves normal HMR outside content: %s', (file) => {
    const { result, send, invalidateModule } = run(file);
    expect(result).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(invalidateModule).not.toHaveBeenCalled();
  });

  it('does not send browser reloads from the SSR environment', () => {
    expect(run('/repo/docs/en/index.md', 'ssr').send).not.toHaveBeenCalled();
  });
});
