import { AlertTriangle, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { useResizeObserver } from '../../hooks/use-resize-observer';
import { cn } from '../../lib/cn';
import { useTheme } from '../../theme';

interface MermaidProps {
  /** The Mermaid DSL source. */
  chart: string;
  /**
   * Override the Mermaid theme. When omitted (the common case), the diagram
   * tracks the doc-site's resolved theme via `useTheme()` so toggling
   * light/dark re-renders the SVG with the matching palette.
   */
  theme?: 'light' | 'dark';
  /**
   * Render a placeholder skeleton instead of attempting to render the DSL.
   * Used by the streaming markdown pipeline so partial mermaid blocks (no
   * closing fence yet) don't flash a parse-error card every keystroke.
   */
  streaming?: boolean;
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

/**
 * Lazy-load mermaid the first time the component renders. Clears the
 * cached promise on rejection so a transient failure (network blip,
 * dynamic-import error) doesn't permanently disable mermaid for the
 * lifetime of the page.
 */
function loadMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid')
    .then((mod) => {
      const api = mod.default as MermaidApi;
      api.initialize({ startOnLoad: false, securityLevel: 'strict' });
      return api;
    })
    .catch((cause: unknown) => {
      mermaidPromise = null;
      throw cause;
    });
  return mermaidPromise;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const WHEEL_SENSITIVITY = 0.0015;

function clampZoom(value: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

const INITIAL_VIEWPORT: ViewportState = { zoom: 1, panX: 0, panY: 0 };

/**
 * Render a Mermaid diagram from its DSL source. Mermaid is lazy-loaded
 * so the (~1 MB) dep is only fetched on pages that actually contain a
 * `mermaid` code block. Renders zoom controls (in/out/reset/fullscreen)
 * and supports drag-to-pan + ctrl/cmd-wheel zoom so wide architecture
 * diagrams stay readable on small screens.
 *
 * The transformed SVG sits inside a stage container with overflow hidden
 * so zooming in always anchors at the diagram's top-left and the page
 * itself never reflows under it.
 */
export function Mermaid({ chart, theme, streaming, className }: MermaidProps) {
  const { resolvedTheme } = useTheme();
  const effectiveTheme: 'light' | 'dark' = theme ?? resolvedTheme;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
  } | null>(null);
  // Tracks whether the user has manually zoomed/panned. While false, the
  // ResizeObserver below auto-refits the diagram so it stays fully visible
  // when the stage resizes (fullscreen toggle, window resize). Once the
  // user interacts, we leave their viewport alone.
  const hasUserInteractedRef = useRef(false);
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/[:]/g, '-')}`;

  useEffect(() => {
    if (streaming) return undefined;
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
        // Mermaid emits the root `<svg>` with `width="100%"` and a viewBox.
        // With no height attribute the SVG collapses to its intrinsic
        // aspect ratio inside the parent — wide flowcharts shrink to a
        // thin strip. Pin the root <svg> to its viewBox dimensions so it
        // renders at natural size; the stage layer above handles fit-zoom.
        //
        // Targeting only the *root* <svg> (not nested elements that may
        // also carry `width`/`height` attributes) and accepting any
        // viewBox origin — sequence diagrams emit `viewBox="-N -M W H"`
        // with negative offsets for participant lines, so the previous
        // `viewBox="0 0 ..."` regex skipped them and the SVG rendered
        // with no fixed dimensions.
        const fixed = result.svg.replace(
          /<svg([^>]*)>/,
          (_match, rawAttrs: string) => {
            const viewBox =
              /viewBox="(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)"/.exec(
                rawAttrs,
              );
            let cleaned = rawAttrs
              .replace(/\swidth="[^"]*"/, '')
              .replace(/\sheight="[^"]*"/, '')
              .replace(/\sstyle="([^"]*)"/, (_m: string, styles: string) => {
                const out = styles
                  .split(';')
                  .map((s) => s.trim())
                  .filter(
                    (s) =>
                      s &&
                      !/^(?:max-width|max-height|width|height)\s*:/i.test(s),
                  )
                  .join('; ');
                return out ? ` style="${out}"` : '';
              });
            if (viewBox) {
              const w = viewBox[3];
              const h = viewBox[4];
              cleaned = ` width="${w}" height="${h}"${cleaned}`;
            }
            return `<svg${cleaned}>`;
          },
        );
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
      // Mermaid mounts a temporary `<div id={id}>` to the document body
      // while rendering — and on parse error leaves an SVG fragment
      // (`<div id="d{id}">`) attached. Without cleanup, every revisit to a
      // failing chart adds another stray fragment outside our component.
      for (const stale of [id, `d${id}`]) {
        const el = document.getElementById(stale);
        if (el && el.parentElement === document.body) {
          el.remove();
        }
      }
    };
  }, [chart, effectiveTheme, id, streaming]);

  /**
   * Apply a zoom change while keeping `anchor` (a stage-relative point)
   * pinned in place. Without this, increasing zoom shifts the diagram
   * because the scale runs from `transform-origin: 0 0` — the user's
   * scrolled / dragged position would slide off-screen on every step.
   *
   * Math: if the current transform is `screen = pan + zoom * local`, then
   * the local point under the anchor is `(anchor - pan) / zoom`. After
   * changing zoom, choose pan such that the same local point still sits
   * under the anchor.
   */
  const applyZoom = useCallback(
    (
      next: number | ((prev: number) => number),
      anchor?: { x: number; y: number },
    ) => {
      setViewport((prev) => {
        const nextZoom = clampZoom(
          typeof next === 'function' ? next(prev.zoom) : next,
        );
        if (nextZoom === prev.zoom) return prev;
        hasUserInteractedRef.current = true;
        const stage = stageRef.current;
        const ax = anchor?.x ?? (stage ? stage.clientWidth / 2 : 0);
        const ay = anchor?.y ?? (stage ? stage.clientHeight / 2 : 0);
        const worldX = (ax - prev.panX) / prev.zoom;
        const worldY = (ay - prev.panY) / prev.zoom;
        return {
          zoom: nextZoom,
          panX: ax - nextZoom * worldX,
          panY: ay - nextZoom * worldY,
        };
      });
    },
    [],
  );

  /**
   * Recenter the diagram in the stage at a zoom level that fits the
   * full diagram inside the viewport. The transform is anchored at
   * `0 0`, so the SVG sits in the top-left corner by default; this also
   * offsets it to the middle. Capped at zoom 1 so small diagrams aren't
   * blown up beyond their natural size.
   */
  const fitInStage = useCallback((): ViewportState => {
    const stage = stageRef.current;
    const inner = containerRef.current?.querySelector('svg');
    if (!stage || !inner) return INITIAL_VIEWPORT;
    const stageRect = stage.getBoundingClientRect();
    const svgWidth = parseFloat(inner.getAttribute('width') ?? '0') || 0;
    const svgHeight = parseFloat(inner.getAttribute('height') ?? '0') || 0;
    if (!svgWidth || !svgHeight || !stageRect.width || !stageRect.height) {
      return INITIAL_VIEWPORT;
    }
    const fitZoom = clampZoom(
      Math.min(1, stageRect.width / svgWidth, stageRect.height / svgHeight),
    );
    return {
      zoom: fitZoom,
      panX: (stageRect.width - svgWidth * fitZoom) / 2,
      panY: (stageRect.height - svgHeight * fitZoom) / 2,
    };
  }, []);

  const reset = useCallback(() => {
    setViewport(fitInStage());
  }, [fitInStage]);

  // Reset interaction tracking + run an initial fit each time the SVG
  // mounts or the stage swaps between inline and fullscreen. Subsequent
  // refits during the same SVG lifecycle are driven by the resize
  // observer below.
  useEffect(() => {
    if (!svg) return;
    hasUserInteractedRef.current = false;
    const raf = requestAnimationFrame(() => setViewport(fitInStage()));
    return () => cancelAnimationFrame(raf);
  }, [svg, isFullscreen, fitInStage]);

  // Refit on stage resize (browser resize, sidebar collapse, etc.) — but
  // only while the user hasn't manually zoomed/panned. Their viewport
  // sticks once they interact.
  useResizeObserver(stageRef.current, () => {
    if (hasUserInteractedRef.current) return;
    setViewport(fitInStage());
  });

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

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(event.pointerId);
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originPanX: viewport.panX,
      originPanY: viewport.panY,
    };
    setIsPanning(true);
    hasUserInteractedRef.current = true;
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    setViewport((prev) => ({
      ...prev,
      panX: state.originPanX + dx,
      panY: state.originPanY + dy,
    }));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const stage = stageRef.current;
    if (stage?.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
    panStateRef.current = null;
    setIsPanning(false);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // Reserve unmodified wheel for page scroll; require ctrl/cmd to zoom.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const stage = stageRef.current;
    const rect = stage?.getBoundingClientRect();
    const anchor = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : undefined;
    applyZoom((prev) => prev * (1 - event.deltaY * WHEEL_SENSITIVITY), anchor);
  };

  if (streaming) {
    return (
      <div
        className={cn(
          'border-border-base bg-bg-elevated/30 my-6 flex h-72 flex-col items-center justify-center rounded-lg border',
          className,
        )}
        role="status"
        aria-label="Mermaid diagram (preparing)"
        aria-busy="true"
      >
        <div className="text-fg-subtle font-mono text-xs tracking-wide uppercase">
          Preparing diagram…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'border-danger/40 bg-danger-bg/40 text-fg-base my-6 overflow-hidden rounded-lg border',
          className,
        )}
        role="img"
        aria-label="Mermaid diagram (failed to render)"
      >
        <div className="border-danger/20 bg-danger/10 flex items-start gap-2.5 border-b px-4 py-3">
          <AlertTriangle
            aria-hidden
            className="text-danger mt-0.5 size-4 shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-fg-base text-sm font-medium">
              Diagram failed to render
            </div>
            <div className="text-fg-muted font-mono text-xs break-words">
              {error}
            </div>
          </div>
        </div>
        <details className="group/mermaid-error">
          <summary className="text-fg-muted hover:text-fg-base cursor-pointer list-none px-4 py-2 text-xs select-none [&::-webkit-details-marker]:hidden">
            <span className="group-open/mermaid-error:hidden">Show source</span>
            <span className="hidden group-open/mermaid-error:inline">
              Hide source
            </span>
          </summary>
          <pre className="text-fg-muted overflow-x-auto px-4 pb-3 font-mono text-[11px] leading-snug">
            {chart}
          </pre>
        </details>
      </div>
    );
  }

  const controls = (
    <div className="border-border-base bg-bg-base/90 supports-backdrop-filter:bg-bg-base/70 absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border p-0.5 shadow-sm backdrop-blur print:hidden">
      <button
        type="button"
        onClick={() => applyZoom((z) => z - ZOOM_STEP)}
        disabled={viewport.zoom <= ZOOM_MIN}
        aria-label="Zoom out"
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus aria-hidden className="size-3.5" />
      </button>
      <span
        aria-live="polite"
        className="text-fg-muted min-w-10 text-center font-mono text-[11px] tabular-nums"
      >
        {Math.round(viewport.zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => applyZoom((z) => z + ZOOM_STEP)}
        disabled={viewport.zoom >= ZOOM_MAX}
        aria-label="Zoom in"
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated inline-flex size-7 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={
          viewport.zoom === 1 && viewport.panX === 0 && viewport.panY === 0
        }
        aria-label="Reset zoom and pan"
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
      ref={stageRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={handleWheel}
      className={cn(
        'relative touch-none overflow-hidden select-none',
        // `min-h-72` reserves space while mermaid lazy-loads (~1MB chunk) so
        // the surrounding prose doesn't reflow when the SVG finally arrives.
        // It also gives drag-to-pan a useful viewport when the diagram is
        // smaller than the screen.
        isFullscreen ? 'h-full w-full' : 'min-h-72',
        viewport.zoom > 1
          ? isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
          : 'cursor-default',
      )}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label="Mermaid diagram"
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
        // Inline transform owns positioning. Without absolute + top/left 0
        // the SVG would inherit auto-centering from the stage's flex/grid
        // context and fight the transform.
        className="absolute top-0 left-0 [&>svg]:max-w-none"
        // oxlint-disable-next-line react/no-danger -- Mermaid output is SVG by design
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
    </div>
  );

  if (isFullscreen) {
    return (
      <div
        className="bg-bg-base/95 supports-backdrop-filter:bg-bg-base/85 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur"
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
