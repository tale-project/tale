import { describe, expect, it } from 'vitest';

import { yamlImports } from './yaml';

/** The plugin registers a bare-function `transform` returning `{code}` or
 * null; the real vite hook type is far wider than this plugin uses, so reach
 * it through the escape hatch rather than model the whole signature. */
type BareTransform = (code: string, id: string) => { code: string } | null;

function transform(code: string, id: string): string | null {
  const { transform: hook } = yamlImports();
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- vite's transform hook type is far wider than this plugin's bare-function form
  const fn = hook as unknown as BareTransform;
  return fn(code, id)?.code ?? null;
}

describe('yamlImports', () => {
  it('turns a .yml module into an export-default of parsed data', () => {
    const out = transform('seo:\n  home:\n    title: Hello\n', '/x/en.yml');
    expect(out).toBe('export default {"seo":{"home":{"title":"Hello"}}};');
  });

  it('leaves non-yaml ids untouched', () => {
    expect(transform('const a = 1;', '/x/a.ts')).toBeNull();
  });

  it('is idempotent — already-transformed code passes through', () => {
    // What a second plugin instance would receive on a Storybook build that
    // both inherits the app vite config and gets the shared copy. Re-parsing
    // this JSON-bearing JS as YAML used to throw ("Nested mappings…").
    const transformed = 'export default {"seo":{"home":{"title":"Hi"}}};';
    expect(transform(transformed, '/x/en.yml')).toBeNull();
  });
});
