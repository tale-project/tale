import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
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

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

/**
 * Render a Mermaid diagram from its DSL source. Mermaid is lazy-loaded
 * so the (~1 MB) dep is only fetched on pages that actually contain a
 * `mermaid` code block. Renders zoom controls (in/out/reset/fullscreen)
 * so wide architecture diagrams stay readable on small screens.
 */
export function Mermaid({ chart, theme, className }: MermaidProps) {
  const { resolvedTheme } = useTheme();
  const effectiveTheme: 'light' | 'dark' = theme ?? resolvedTheme;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

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

  const controls = (
    <div className="border-border-base bg-bg-base/90 supports-[backdrop-filter]:bg-bg-base/70 absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border p-0.5 shadow-sm backdrop-blur print:hidden">
      <button
        type="button"
        onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
        disabled={zoom <= ZOOM_MIN}
        aria-label="Zoom out"
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus aria-hidden className="size-3.5" />
      </button>
      <span
        aria-live="polite"
        className="text-fg-muted min-w-10 text-center font-mono text-[11px] tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
        disabled={zoom >= ZOOM_MAX}
        aria-label="Zoom in"
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setZoom(1)}
        disabled={zoom === 1}
        aria-label="Reset zoom"
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RotateCcw aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setIsFullscreen((v) => !v)}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors"
      >
        <Maximize2 aria-hidden className="size-3.5" />
      </button>
    </div>
  );

  const stage = (
    <div
      ref={wrapperRef}
      className={cn(
        'relative overflow-auto',
        // `min-h-24` reserves space while mermaid lazy-loads (~1MB chunk) so
        // the surrounding prose doesn't reflow when the SVG finally arrives.
        isFullscreen ? 'h-full w-full' : 'min-h-24',
      )}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label="Mermaid diagram"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          width: zoom === 1 ? undefined : `${100 / zoom}%`,
        }}
        className="transition-transform [&>svg]:mx-auto [&>svg]:max-w-none"
        // oxlint-disable-next-line react/no-danger -- Mermaid output is SVG by design
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );

  if (isFullscreen) {
    return (
      <div
        className="bg-bg-base/95 supports-[backdrop-filter]:bg-bg-base/85 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur"
        role="dialog"
        aria-modal="true"
        aria-label="Mermaid diagram (fullscreen)"
      >
        {controls}
        {stage}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border-border-base bg-bg-elevated/30 relative my-6 rounded-lg border',
        className,
      )}
    >
      {controls}
      {stage}
    </div>
  );
}
