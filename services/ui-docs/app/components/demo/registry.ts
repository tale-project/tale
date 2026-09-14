import type { ComponentType } from 'react';

/**
 * The demo registry. Every file under `app/demos/<family>/<name>.tsx` is a
 * live example addressed from markdown as `<Demo name="<family>/<name>" />`.
 *
 * Two globs over the same tree:
 *
 *  - the COMPONENT glob is eager, so a demo renders during SSR and lands in
 *    the prerendered HTML. A lazy glob would render a Suspense fallback under
 *    `renderToString`, and every page would ship to crawlers with holes where
 *    its examples are.
 *  - the SOURCE glob is lazy: the raw text is only needed once a reader opens
 *    the "Code" panel, so it never weighs on first paint.
 */

type DemoComponent = ComponentType;

function demoNameFromPath(path: string): string | null {
  const match = /\/demos\/(.+)\.tsx$/.exec(path);
  return match ? match[1] : null;
}

const components = new Map<string, DemoComponent>();
{
  const eager = import.meta.glob('../../demos/**/*.tsx', {
    eager: true,
  }) as unknown as Record<string, { default?: DemoComponent }>;
  for (const [path, mod] of Object.entries(eager)) {
    const name = demoNameFromPath(path);
    if (name && mod.default) components.set(name, mod.default);
  }
}

const sourceLoaders = new Map<string, () => Promise<string>>();
{
  const lazy = import.meta.glob('../../demos/**/*.tsx', {
    query: '?raw',
    import: 'default',
  }) as unknown as Record<string, () => Promise<string>>;
  for (const [path, load] of Object.entries(lazy)) {
    const name = demoNameFromPath(path);
    if (name) sourceLoaders.set(name, load);
  }
}

/** The component registered under a demo name, or `undefined`. */
export function getDemoComponent(name: string): DemoComponent | undefined {
  return components.get(name);
}

/** Load a demo's raw source. Resolves to `null` when the name is unknown. */
export async function loadDemoSource(name: string): Promise<string | null> {
  const load = sourceLoaders.get(name);
  if (!load) return null;
  return load();
}

/** Every registered demo name — the parity test walks this. */
export function allDemoNames(): string[] {
  return [...components.keys()].sort();
}
