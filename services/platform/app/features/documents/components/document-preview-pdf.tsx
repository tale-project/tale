'use client';

import { ChevronUp, ChevronDown, ZoomIn, ZoomOut } from 'lucide-react';
// PDF.js is bundled locally (see pdfjs-dist in package.json). Loading it from
// a CDN would break offline deployments and count as a third-party data
// transfer for GDPR purposes. The worker URL is resolved through Vite's
// `new URL(..., import.meta.url)` pattern so it ships as a build asset
// served same-origin.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import React, { useReducer, useEffect, useRef, useCallback } from 'react';

import { HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';

import { PreviewPane } from './preview-pane';

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
    } catch (error) {
      console.error('Error rendering page:', error);
    } finally {
      dispatch({ type: 'RENDER_COMPLETE' });
    }
  };

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
      const lib = await import('pdfjs-dist');
      if (cancelled) return;
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

  return (
    <>
      <PreviewPane className="overflow-x-auto">
        <div className="flex min-h-full w-fit min-w-full justify-center">
          <canvas
            ref={canvasRef}
            className="block h-auto"
            style={{ maxWidth: `calc(48rem * ${state.scale})` }}
          />
        </div>
        {/* Sticky center-bottom toolbar */}
        <div className="sticky bottom-4 z-50 flex w-full justify-center">
          <HStack
            gap={4}
            className="bg-background text-foreground rounded-full px-4 py-2 shadow-xl ring-1 ring-white/10"
          >
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
              className="bg-background w-10 appearance-none rounded-md py-1 text-center text-sm ring-1 ring-white/20 focus:ring-white/40 focus:outline-none"
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
        </div>
        {!state.pdfDoc && (
          <div className="mt-4 text-center text-gray-500">
            {t('preview.loading')}
          </div>
        )}
      </PreviewPane>
    </>
  );
};
