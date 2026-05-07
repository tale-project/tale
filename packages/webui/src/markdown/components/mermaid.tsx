import { cn } from '@tale/ui/cn';
import { useEffect, useId, useRef, useState } from 'react';

interface MermaidProps {
  /** The Mermaid DSL source. */
  chart: string;
  /** `light` | `dark` — controls the Mermaid theme. */
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
export function Mermaid({ chart, theme = 'light', className }: MermaidProps) {
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
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
        });
        return mermaid.render(id, chart);
      })
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
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
  }, [chart, theme, id]);

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
        'my-6 flex justify-center overflow-x-auto [&>svg]:max-w-full',
        className,
      )}
      // oxlint-disable-next-line react/no-danger -- Mermaid output is SVG by design
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
