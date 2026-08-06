'use client';

import { HStack, Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  ChevronUp,
  ChevronDown,
  GripVertical,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
// PDF.js is bundled locally (see pdfjs-dist in package.json). Loading it from
// a CDN would break offline deployments and count as a third-party data
// transfer for GDPR purposes. Vite's `?url` suffix emits the worker as a
// build asset served same-origin; oxlint doesn't understand that query and
// flags a missing default export on the ESM worker file.
// eslint-disable-next-line import/default
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import React, {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useState,
} from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// The pdfjs viewer entrypoint reads its core API from `globalThis.pdfjsLib` on
// load (see the bootstrap effect below). Declaring it on the global type lets
// us assign it without an unsafe type assertion.
declare global {
  // eslint-disable-next-line no-var
  var pdfjsLib: typeof import('pdfjs-dist') | undefined;
}

import './pdf-layers.css';
import { PdfLinkPopup, type PdfLinkPopupState } from './pdf-link-popup';
import { PreviewPane, previewPaneCanvasClasses } from './preview-pane';

interface ViewerState {
  pdfDoc: PDFDocumentProxy | null;
  pageNum: number;
  pageRendering: boolean;
  pageNumPending: RenderParams | null;
  totalPages: number;
  scale: number;
}

interface RenderParams {
  pageNum: number;
  scale: number;
}

type ViewerAction =
  | { type: 'PDF_LOADED'; doc: PDFDocumentProxy }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_SCALE'; scale: number }
  | { type: 'RENDER_START' }
  | { type: 'RENDER_COMPLETE' }
  | { type: 'QUEUE_PENDING'; params: RenderParams }
  | { type: 'CONSUME_PENDING' };

const initialState: ViewerState = {
  pdfDoc: null,
  pageNum: 1,
  pageRendering: false,
  pageNumPending: null,
  totalPages: 0,
  scale: 1.0,
};

function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'PDF_LOADED':
      return {
        ...state,
        pdfDoc: action.doc,
        totalPages: action.doc.numPages,
        pageNum: 1,
      };
    case 'SET_PAGE':
      return { ...state, pageNum: action.page };
    case 'SET_SCALE':
      return { ...state, scale: action.scale };
    case 'RENDER_START':
      return { ...state, pageRendering: true };
    case 'RENDER_COMPLETE':
      return { ...state, pageRendering: false };
    case 'QUEUE_PENDING':
      return { ...state, pageNumPending: action.params };
    case 'CONSUME_PENDING':
      return { ...state, pageNumPending: null };
    default:
      return state;
  }
}

export const DocumentPreviewPDF = ({ url }: { url: string }) => {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const [state, dispatch] = useReducer(viewerReducer, initialState);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // Container sized to the CSS footprint of the page; the canvas plus the text
  // and annotation layers all stack inside it so the selectable text and the
  // clickable links line up pixel-for-pixel with the rasterised page. The text
  // and annotation layer <div>s are created and appended here by the pdfjs
  // builders (see renderTextAndAnnotationLayers).
  const pageWrapRef = useRef<HTMLDivElement | null>(null);

  const [linkPopup, setLinkPopup] = useState<PdfLinkPopupState | null>(null);
  const pdfLibRef = useRef<typeof import('pdfjs-dist') | null>(null);
  // pdfjs's high-level layer builders + a navigation-less link service live in
  // the viewer entrypoint, loaded lazily alongside the core library.
  const pdfViewerRef = useRef<
    typeof import('pdfjs-dist/web/pdf_viewer.mjs') | null
  >(null);
  const linkServiceRef = useRef<InstanceType<
    (typeof import('pdfjs-dist/web/pdf_viewer.mjs'))['SimpleLinkService']
  > | null>(null);
  const textLayerBuilderRef = useRef<InstanceType<
    (typeof import('pdfjs-dist/web/pdf_viewer.mjs'))['TextLayerBuilder']
  > | null>(null);

  const renderPageRef = useRef<
    ((params: RenderParams) => Promise<void>) | undefined
  >(undefined);
  renderPageRef.current = async (params: RenderParams) => {
    if (!state.pdfDoc || !canvasRef.current) return;

    dispatch({ type: 'RENDER_START' });

    try {
      const page: PDFPageProxy = await state.pdfDoc.getPage(params.pageNum);

      const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
      const scaledViewport: PageViewport = page.getViewport({
        scale: params.scale * deviceScale,
      });

      const bufferCanvas = bufferCanvasRef.current;
      if (!bufferCanvas) return;
      bufferCanvas.width = Math.ceil(scaledViewport.width);
      bufferCanvas.height = Math.ceil(scaledViewport.height);
      const bufferCtx = bufferCanvas.getContext('2d', { alpha: false });
      if (!bufferCtx) return;

      if (
        renderTaskRef.current &&
        typeof renderTaskRef.current.cancel === 'function'
      ) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }

      const renderTask = page.render({
        canvas: bufferCanvas,
        canvasContext: bufferCtx,
        viewport: scaledViewport,
        intent: 'display',
      });
      renderTaskRef.current = renderTask;

      await renderTask.promise.catch((err: Error) => {
        if (err && err.name === 'RenderingCancelledException') {
          return;
        }
        throw err;
      });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      const cssWidth = Math.ceil(scaledViewport.width / deviceScale);
      const cssHeight = Math.ceil(scaledViewport.height / deviceScale);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.ceil(scaledViewport.width);
      canvas.height = Math.ceil(scaledViewport.height);

      ctx.drawImage(bufferCanvas, 0, 0);

      // Size the layer wrapper to the page's CSS footprint so the text and
      // annotation layers overlay the canvas exactly.
      if (pageWrapRef.current) {
        pageWrapRef.current.style.width = `${cssWidth}px`;
        pageWrapRef.current.style.height = `${cssHeight}px`;
      }

      await renderTextAndAnnotationLayers(page, params.scale);
    } catch (error) {
      console.error('Error rendering page:', error);
    } finally {
      dispatch({ type: 'RENDER_COMPLETE' });
    }
  };

  // Renders the selectable text layer and the interactive annotation (link)
  // layer over the rasterised canvas using pdfjs's own layer builders. The
  // builders own the DOM nodes (created and appended via `onAppend`) and, for
  // the text layer, the selection-smoothing handlers (the `.selecting` toggle +
  // `endOfContent` element) that make a drag track the pointer instead of
  // snapping. The viewport is at the CSS scale (without the device-pixel
  // multiplier) so the layers map onto the canvas's displayed size.
  const renderTextAndAnnotationLayers = useCallback(
    async (page: PDFPageProxy, scale: number) => {
      const viewer = pdfViewerRef.current;
      const linkService = linkServiceRef.current;
      const wrap = pageWrapRef.current;
      if (!viewer || !linkService || !wrap) return;

      // pdfjs derives layer + glyph layout from `--scale-factor` (the wrapper's
      // CSS rules turn it into `--total-scale-factor`).
      wrap.style.setProperty('--scale-factor', String(scale));

      const cssViewport = page.getViewport({ scale });

      // Tear down the previous render's layer nodes (the builders append fresh
      // ones each time). Cancelling the text builder also detaches its global
      // selection listeners.
      textLayerBuilderRef.current?.cancel();
      wrap
        .querySelectorAll('.textLayer, .annotationLayer')
        .forEach((node) => node.remove());

      // Text layer (selection).
      try {
        const textBuilder = new viewer.TextLayerBuilder({
          pdfPage: page,
          onAppend: (div: HTMLDivElement) => wrap.append(div),
        });
        textLayerBuilderRef.current = textBuilder;
        await textBuilder.render({ viewport: cssViewport });
      } catch (err) {
        // A re-render cancels the previous text layer; that's expected.
        const isAbort = err instanceof Error && err.name === 'AbortException';
        if (!isAbort) {
          console.warn('Failed to render PDF text layer:', err);
        }
      }

      // Annotation layer (links). SimpleLinkService stamps real hrefs onto the
      // link <a>s; navigation is still intercepted by our own click handler.
      try {
        const annotationBuilder = new viewer.AnnotationLayerBuilder({
          pdfPage: page,
          linkService,
          renderForms: false,
          onAppend: (div: HTMLDivElement) => wrap.append(div),
        });
        await annotationBuilder.render({
          viewport: cssViewport,
          intent: 'display',
        });
      } catch (err) {
        console.warn('Failed to render PDF annotation layer:', err);
      }
    },
    [],
  );

  const queueRenderPage = useCallback(
    (params: RenderParams) => {
      if (state.pageRendering) {
        dispatch({ type: 'QUEUE_PENDING', params });
      } else {
        void renderPageRef.current?.(params);
      }
    },
    [state.pageRendering],
  );

  useEffect(() => {
    if (!state.pageRendering && state.pageNumPending !== null) {
      const pending = state.pageNumPending;
      dispatch({ type: 'CONSUME_PENDING' });
      void renderPageRef.current?.(pending);
    }
  }, [state.pageRendering, state.pageNumPending]);

  useEffect(() => {
    if (!state.pdfDoc) return;
    void renderPageRef.current?.({ pageNum: 1, scale: initialState.scale });
  }, [state.pdfDoc]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The viewer entrypoint reads its core API from `globalThis.pdfjsLib`
      // when it loads, so pin the core lib there before importing it. Loading
      // both in parallel leaves the global unset and the viewer crashes.
      const lib = await import('pdfjs-dist');
      if (cancelled) return;
      globalThis.pdfjsLib = lib;
      const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs');
      if (cancelled) return;
      pdfLibRef.current = lib;
      pdfViewerRef.current = viewer;
      // Navigation-less link service: it builds link <a>s with correct hrefs
      // (inherited addLinkAttributes) but never owns navigation — our click
      // handler shows a popup instead. LinkTarget.BLANK (2) renders externals
      // as new-tab anchors.
      const linkService = new viewer.SimpleLinkService();
      linkService.externalLinkTarget = 2;
      linkServiceRef.current = linkService;
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      try {
        const doc = await lib.getDocument(url).promise;
        if (cancelled) return;
        dispatch({ type: 'PDF_LOADED', doc });
      } catch (error) {
        console.error('Error loading PDF:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    bufferCanvasRef.current = document.createElement('canvas');
    return () => {
      try {
        if (
          renderTaskRef.current &&
          typeof renderTaskRef.current.cancel === 'function'
        ) {
          renderTaskRef.current.cancel();
        }
      } catch {}
      // Detach the text layer's global selection listeners.
      textLayerBuilderRef.current?.cancel();
      textLayerBuilderRef.current = null;
      bufferCanvasRef.current = null;
    };
  }, []);

  const onPrevPage = () => {
    const newPage = Math.max(1, state.pageNum - 1);
    if (newPage !== state.pageNum) {
      dispatch({ type: 'SET_PAGE', page: newPage });
      queueRenderPage({ pageNum: newPage, scale: state.scale });
    }
  };

  const onNextPage = () => {
    const newPage = Math.min(state.totalPages, state.pageNum + 1);
    if (newPage !== state.pageNum) {
      dispatch({ type: 'SET_PAGE', page: newPage });
      queueRenderPage({ pageNum: newPage, scale: state.scale });
    }
  };

  const onZoomOut = () => {
    const newScale = Math.max(0.5, Number((state.scale - 0.1).toFixed(2)));
    if (newScale !== state.scale) {
      dispatch({ type: 'SET_SCALE', scale: newScale });
      queueRenderPage({ pageNum: state.pageNum, scale: newScale });
    }
  };

  const onZoomIn = () => {
    const newScale = Math.min(2.0, Number((state.scale + 0.1).toFixed(2)));
    if (newScale !== state.scale) {
      dispatch({ type: 'SET_SCALE', scale: newScale });
      queueRenderPage({ pageNum: state.pageNum, scale: newScale });
    }
  };

  const onPageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    const bounded = Math.min(Math.max(value, 1), state.totalPages || 1);
    dispatch({ type: 'SET_PAGE', page: bounded });
    queueRenderPage({ pageNum: bounded, scale: state.scale });
  };

  // Intercept clicks on links inside the annotation layer. Rather than letting
  // the browser navigate away from the preview, surface a popup offering to
  // copy the destination or open it in a new tab.
  const onAnnotationLayerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target;
    const anchor = target instanceof Element ? target.closest('a') : null;
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) return;
    // Only intercept external/absolute URLs; in-document jumps (which the link
    // service renders as "#...") shouldn't open a popup.
    if (href.startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();
    setLinkPopup({ url: anchor.href, x: e.clientX, y: e.clientY });
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [toolbarOffset, setToolbarOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const clampToolbarOffset = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    if (!container || !toolbar) return { x, y };
    const c = container.getBoundingClientRect();
    const tb = toolbar.getBoundingClientRect();
    // Default position is centered horizontally with a 16px gap from the
    // bottom. Offsets are measured from that anchor, so positive y moves the
    // toolbar down and negative y moves it up.
    const halfX = Math.max(0, (c.width - tb.width) / 2);
    const maxDown = 0;
    const maxUp = -(c.height - tb.height - 32);
    return {
      x: Math.min(halfX, Math.max(-halfX, x)),
      y: Math.min(maxDown, Math.max(maxUp, y)),
    };
  }, []);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: toolbarOffset.x,
      originY: toolbarOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    setToolbarOffset(
      clampToolbarOffset(
        start.originX + (e.clientX - start.pointerX),
        start.originY + (e.clientY - start.pointerY),
      ),
    );
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      console.warn('Failed to release pointer capture:', err);
    }
    setIsDragging(false);
  };

  return (
    <Stack ref={containerRef} gap={0} className="relative min-h-0 flex-1">
      <PreviewPane className={cn(previewPaneCanvasClasses, 'overflow-x-auto')}>
        <Row
          gap={0}
          align="stretch"
          justify="center"
          className="min-h-full w-fit min-w-full"
        >
          {/* Sized imperatively to the page's CSS footprint after each render so
              the canvas and the pdfjs-appended text/annotation layers share
              identical dimensions and stay pixel-aligned. The click handler is
              delegation only — the real interactive elements are the
              pdfjs-generated, keyboard-focusable <a> link anchors nested inside;
              this wrapper carries no semantics of its own. Wide pages overflow
              into the pane's horizontal scroll. */}
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- delegates to nested focusable <a> link annotations */}
          <div
            ref={pageWrapRef}
            className="pdfLayerWrap relative block shrink-0"
            onClick={onAnnotationLayerClick}
          >
            <canvas ref={canvasRef} className="block size-full" />
          </div>
        </Row>
        {!state.pdfDoc && (
          // Document-shaped pulse matching the rendered page footprint, so the
          // first painted page swaps in without the pane jumping from a
          // centered text line to a full document.
          <Skeletonize
            loading
            label={t('preview.loading')}
            className="absolute inset-6 flex justify-center"
          >
            <SkeletonBox>
              <div className="aspect-[1/1.4] h-full w-full max-w-2xl" />
            </SkeletonBox>
          </Skeletonize>
        )}
      </PreviewPane>
      {/* Floating toolbar pinned to the bottom of the visible pane (draggable) */}
      <Row
        gap={0}
        align="stretch"
        justify="center"
        className="pointer-events-none absolute inset-x-0 bottom-4 z-50"
      >
        <HStack
          ref={toolbarRef}
          gap={2}
          style={{
            transform: `translate(${toolbarOffset.x}px, ${toolbarOffset.y}px)`,
          }}
          className="bg-background text-foreground pointer-events-auto rounded-full py-2 pr-4 pl-2 shadow-[0_8px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.12)] ring-1 ring-black/8 dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] dark:ring-white/10"
        >
          <button
            type="button"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className={`text-muted-foreground grid size-8 touch-none place-items-center rounded-full transition hover:bg-white/10 ${
              isDragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            aria-label={t('preview.dragToolbar')}
          >
            <GripVertical className="size-4" />
          </button>
          <HStack gap={2}>
            <button
              onClick={onPrevPage}
              disabled={state.pageNum <= 1}
              className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
              aria-label={tCommon('aria.previousPage')}
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              onClick={onNextPage}
              disabled={state.pageNum >= state.totalPages}
              className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
              aria-label={tCommon('aria.nextPage')}
            >
              <ChevronDown className="size-5" />
            </button>
          </HStack>
          <input
            type="number"
            min={1}
            max={Math.max(1, state.totalPages)}
            value={state.pageNum}
            onChange={onPageInputChange}
            className="bg-background w-12 appearance-none rounded-md py-1 text-center text-base ring-1 ring-white/20 focus:ring-white/40 focus:outline-none md:w-10 md:text-sm"
          />
          <div>/</div>
          <div className="w-4 text-center text-sm tabular-nums">
            {state.totalPages || 0}
          </div>
          <HStack gap={2}>
            <button
              onClick={onZoomOut}
              className="grid size-8 place-items-center rounded-full transition hover:bg-white/10"
              aria-label={tCommon('aria.zoomOut')}
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              onClick={onZoomIn}
              className="grid size-8 place-items-center rounded-full transition hover:bg-white/10"
              aria-label={tCommon('aria.zoomIn')}
            >
              <ZoomIn className="size-4" />
            </button>
          </HStack>
        </HStack>
      </Row>
      {linkPopup && (
        <PdfLinkPopup state={linkPopup} onClose={() => setLinkPopup(null)} />
      )}
    </Stack>
  );
};
