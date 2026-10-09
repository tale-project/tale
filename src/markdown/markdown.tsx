import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// KaTeX's stylesheet, self-hosted via a JS side-effect import (not a CSS
// `@import`) so the bundler rebases its `url()` webfont refs to hashed build
// assets — the same routing `../fonts.ts` uses for the Inter webfont. Every
// consumer of `<Markdown>` picks the styles up; the streaming
// `IncrementalMarkdown` loads them with KaTeX itself (`streaming/lazy-katex.ts`).
import 'katex/dist/katex.min.css';
import { baseComponents } from './base-components';
import { rehypeNumericColumns } from './plugins/rehype-numeric-columns';
import { rehypePreserveCodeMeta } from './plugins/rehype-preserve-code-meta';
import { remarkFrame } from './plugins/remark-frame';

export { baseComponents, makePreComponent } from './base-components';

interface MarkdownProps {
  children: string;
  /** Override or extend the component map. */
  components?: Components;
  className?: string;
}

export const Markdown = memo(function Markdown({
  children,
  components,
  className,
}: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        // `remarkMath` parses `$…$` (inline) and `$$…$$` (block) into math
        // nodes so `rehypeKatex` can render them; without it TeX would show
        // verbatim. It sits after `remarkGfm` so GFM tables/lists/fences are
        // unaffected.
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          ...(components && 'tale-frame' in components ? [remarkFrame] : []),
        ]}
        // `rehypePreserveCodeMeta` lifts each code fence's metastring
        // (the part after the language, e.g. `` ```python Python ``) onto
        // a `data-meta` attribute. It must run before `rehype-raw`, which
        // serialises and reparses the tree and would otherwise drop the
        // parser-only `data.meta` field. Consumers (e.g. CodeGroup tab
        // labels) then read it back as `child.props['data-meta']`.
        // `rehype-raw` reparses raw HTML embedded in markdown so authored
        // tags like `<CodeGroup>`, `<Note>`, `<Card>` survive as hast nodes
        // and reach the components map below. Without it those tags are
        // dropped silently and only the prose between them renders.
        // `rehypeNumericColumns` walks each table and tags columns whose
        // body cells are all numeric-like with `text-right`, so finance /
        // metric tables read aligned without any author opt-in.
        // `rehypeKatex` renders the `language-math` nodes `remarkMath`
        // produced into KaTeX markup. It runs last — after `rehypeRaw`, so
        // any raw-HTML-embedded math is parsed first, and after the other
        // transforms so it replaces the math `<pre>`/`<code>` wholesale
        // before they reach the code-block component map.
        rehypePlugins={[
          rehypePreserveCodeMeta,
          rehypeRaw,
          rehypeNumericColumns,
          rehypeKatex,
        ]}
        components={{ ...baseComponents, ...components }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
