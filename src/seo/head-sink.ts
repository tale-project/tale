/**
 * SSR head-collection seam. During `renderToString`, the prerenderer wraps
 * the app in `<HeadSinkContext.Provider value={sink}>` and reads
 * `sink.tags` afterwards. `useDocumentMeta` records into the sink *during
 * render* (effects don't run under `renderToString`), so the captured head
 * is exactly what the route declared.
 *
 * On the client the provider is absent (`useContext` returns `null`), so
 * the hook falls back to its `useEffect` DOM path — zero client behaviour
 * change.
 */

import { createContext } from 'react';

import type { HeadTag } from './head-tags';

interface HeadSink {
  /** Last writer wins — one `useDocumentMeta` call per render in practice. */
  tags: HeadTag[];
}

export function createHeadSink(): HeadSink {
  return { tags: [] };
}

export const HeadSinkContext = createContext<HeadSink | null>(null);
