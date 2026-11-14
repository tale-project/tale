import { useEffect, useSyncExternalStore } from 'react';
import type { Options as MarkdownOptions } from 'react-markdown';

type RehypePlugin = NonNullable<MarkdownOptions['rehypePlugins']>[number];

/**
 * `rehype-katex` and its stylesheet, loaded the first time a reply may hold
 * math. KaTeX is 85 KB gzip, and the streaming renderer sits in every chat,
 * so it was part of every cold load, the sign-in page's included,
 * for the few replies that carry `$…$`. Until it arrives, `remark-math`'s
 * nodes render as their TeX; then every renderer that asked re-renders with
 * KaTeX, a reply streaming in at that moment included.
 */
let plugin: RehypePlugin | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadKatex(): Promise<void> {
  loading ??= Promise.all([import('rehype-katex'), import('./katex-styles')])
    .then(([katex]) => {
      plugin = katex.default;
      for (const listener of listeners) listener();
    })
    .catch((error: unknown) => {
      // A chunk that did not arrive (offline, a deploy replaced it) leaves
      // the TeX as text; the next reply with math asks again.
      loading = null;
      console.warn('[markdown] KaTeX did not load; math shows as TeX', error);
    });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): RehypePlugin | null {
  return plugin;
}

/**
 * The KaTeX rehype plugin once it has loaded, else `null`. A `content` that
 * may hold math (it has a `$`) starts the load.
 */
export function useLazyKatex(content: string): RehypePlugin | null {
  const loaded = useSyncExternalStore(subscribe, read, read);
  const wanted = loaded === null && content.includes('$');
  useEffect(() => {
    if (wanted) void loadKatex();
  }, [wanted]);
  return loaded;
}
