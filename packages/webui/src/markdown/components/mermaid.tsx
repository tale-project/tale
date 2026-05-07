import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { useEffect, useId, useRef, useState } from 'react';

interface MermaidProps {
  /** The Mermaid DSL source. */
  chart: string;
  /**
   * Override the Mermaid theme. When omitted (the common case), the diagram
   * tracks the doc-site's resolved theme via `useTheme()` so toggling
   * light/dark re-renders the SVG with the matching palette.
   */
  theme?: 'light' | 'dark';
  className?: string;
}

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    chart: string,
  ) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
}

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Lazy-load mermaid the first time the component renders. */
function loadMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((mod) => {
    const api = mod.default as MermaidApi;
    api.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return api;
  });
  return mermaidPromise;
}

/**
 * Render a Mermaid diagram from its DSL source. Mermaid is lazy-loaded
 * so the (~1 MB) dep is only fetched on pages that actually contain a
 * `mermaid` code block.
 */
export function Mermaid({ chart, theme, className }: MermaidProps) {
  const { resolvedTheme } = useTheme();
  const effectiveTheme: 'light' | 'dark' = theme ?? resolvedTheme;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/[:]/g, '-')}`;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg(null);
    void loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: effectiveTheme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        return mermaid.render(id, chart);
      })
      .then((result) => {
        if (cancelled) return;
        // Mermaid emits `width="100%"` plus a viewBox. With no height, the
        // SVG's intrinsic aspect ratio shrinks to fit the parent — wide
        // flowcharts collapse into a thin strip. Pin the SVG to the viewBox
        // dimensions so it renders at natural size and the wrapper scrolls
        // horizontally if it overflows.
        const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(result.svg);
        let fixed = result.svg
          .replace(/\swidth="[^"]*"/, '')
          .replace(/\sheight="[^"]*"/, '')
          .replace(/\sstyle="max-width:[^"]*"/, '');
        if (viewBox) {
          const w = viewBox[1];
          const h = viewBox[2];
          fixed = fixed.replace(/<svg /, `<svg width="${w}" height="${h}" `);
        }
        setSvg(fixed);
        if (result.bindFunctions && containerRef.current) {
          result.bindFunctions(containerRef.current);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message =
          cause instanceof Error ? cause.message : 'Mermaid render failed';
        setError(message);
        console.warn('[mermaid] render failed', cause);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, effectiveTheme, id]);

  if (error) {
    return (
      <pre
        className={cn(
          'border-border-base bg-bg-elevated text-fg-muted my-6 overflow-x-auto rounded-lg border p-4 text-xs',
          className,
        )}
        role="img"
        aria-label="Mermaid diagram (failed to render)"
      >
        {chart}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Mermaid diagram"
      className={cn(
        // `min-h-24` reserves space while mermaid lazy-loads (~1MB chunk) so
        // the surrounding prose doesn't reflow when the SVG finally arrives.
        'my-6 min-h-24 overflow-x-auto [&>svg]:mx-auto [&>svg]:max-w-none',
        className,
      )}
      // oxlint-disable-next-line react/no-danger -- Mermaid output is SVG by design
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
