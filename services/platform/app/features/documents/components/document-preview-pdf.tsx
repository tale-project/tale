'use client';

import { ChevronUp, ChevronDown, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useState, useEffect, useRef, useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

interface PageViewport {
  width: number;
  height: number;
}

interface RenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

interface PDFPageProxy {
  getViewport: (options: { scale: number }) => PageViewport;
  render: (options: {
    canvas: HTMLCanvasElement | null;
    canvasContext: CanvasRenderingContext2D;
    viewport: PageViewport;
    intent: string;
  }) => RenderTask;
}

interface PDFDocumentProxy {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PDFPageProxy>;
}

interface PDFDocumentLoadingTask {
  promise: Promise<PDFDocumentProxy>;
}

interface PdfJsLib {
  getDocument: (url: string) => PDFDocumentLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
}

export const DocumentPreviewPDF = ({ url }: { url: string }) => {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState<number>(1);
  const [pageRendering, setPageRendering] = useState<boolean>(false);
  const [pageNumPending, setPageNumPending] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [pdfjsLib, setPdfjsLib] = useState<PdfJsLib | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  // Load PDF.js library
  useEffect(() => {
    const loadPdfJs = async () => {
      try {
        // Load PDF.js from CDN
        const script = document.createElement('script');
        script.src =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.addEventListener('load', () => {
          // CDN script injects pdfjsLib on window — no typed global available
          const lib = (window as unknown as { pdfjsLib: PdfJsLib }).pdfjsLib;
          lib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setPdfjsLib(lib);
        });
        document.head.appendChild(script);
      } catch (error) {
        console.error('Error loading PDF.js:', error);
      }
    };

    loadPdfJs();
  }, []);

  // Initialize offscreen buffer canvas and cleanup
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

  // Render page function
  const renderPage = async (num: number) => {
    if (!pdfDoc || !canvasRef.current) return;

    setPageRendering(true);

    try {
      const page: PDFPageProxy = await pdfDoc.getPage(num);

      // Respect device pixel ratio to avoid blurry output and layout thrash
      const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
      const scaledViewport: PageViewport = page.getViewport({
        scale: scale * deviceScale,
      });

      // Prepare offscreen buffer to render into (prevents visible flicker)
      const bufferCanvas = bufferCanvasRef.current;
      if (!bufferCanvas) return;
      bufferCanvas.width = Math.ceil(scaledViewport.width);
      bufferCanvas.height = Math.ceil(scaledViewport.height);
      const bufferCtx = bufferCanvas.getContext('2d', { alpha: false });
      if (!bufferCtx) return;

      // Cancel any in-flight render before starting a new one
      if (
        renderTaskRef.current &&
        typeof renderTaskRef.current.cancel === 'function'
      ) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }

      const renderTask = page.render({
        canvas: null,
        canvasContext: bufferCtx,
        viewport: scaledViewport,
        intent: 'display',
      });
      renderTaskRef.current = renderTask;

      await renderTask.promise.catch((err: Error) => {
        if (err && err.name === 'RenderingCancelledException') {
          return; // swallow cancellation
        }
        throw err;
      });

      // Blit buffer into the visible canvas in one operation
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      // Update visible canvas size (in CSS and pixels) just before drawing
      const cssWidth = Math.ceil(scaledViewport.width / deviceScale);
      const cssHeight = Math.ceil(scaledViewport.height / deviceScale);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.ceil(scaledViewport.width);
      canvas.height = Math.ceil(scaledViewport.height);

      ctx.drawImage(bufferCanvas, 0, 0);

      // Handle pending page render
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        setPageNumPending(null);
      }
    } catch (error) {
      console.error('Error rendering page:', error);
    } finally {
      setPageRendering(false);
    }
  };

  // Queue page render
  const queueRenderPage = useCallback(
    (num: number) => {
      if (pageRendering) {
        setPageNumPending(num);
      } else {
        renderPage(num);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderPage uses refs and is not easily memoizable
    [pageRendering],
  );

  // Navigation functions
  const onPrevPage = () => {
    if (pageNum <= 1) return;
    setPageNum(pageNum - 1);
  };

  const onNextPage = () => {
    if (pageNum >= totalPages) return;
    setPageNum(pageNum + 1);
  };

  const onZoomOut = () => {
    setScale((s) => Math.max(0.5, Number((s - 0.1).toFixed(2))));
  };

  const onZoomIn = () => {
    setScale((s) => Math.min(2.0, Number((s + 0.1).toFixed(2))));
  };

  const onPageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (Number.isNaN(value)) return;
    const bounded = Math.min(Math.max(value, 1), totalPages || 1);
    setPageNum(bounded);
  };

  // Effect to render page when pageNum changes
  useEffect(() => {
    if (pdfDoc) {
      queueRenderPage(pageNum);
    }
  }, [scale, pageNum, pdfDoc, queueRenderPage]);

  // Load PDF document
  useEffect(() => {
    if (pdfjsLib) {
      const loadingTask = pdfjsLib.getDocument(url);
      loadingTask.promise
        .then((doc: PDFDocumentProxy) => {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
        })
        .catch((error: unknown) => {
          console.error('Error loading PDF:', error);
        });
    }
  }, [pdfjsLib, url]);

  return (
    <>
      <div className="relative mx-auto w-full flex-1 overflow-x-visible overflow-y-auto p-6">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-1/2 block -translate-x-1/2"
          style={{ maxWidth: `calc(48rem * ${scale})`, height: 'auto' }}
        />
        {/* Sticky center-bottom toolbar */}
        <div className="sticky top-[95%] z-50 flex w-full justify-center">
          <div className="bg-background text-foreground flex items-center gap-4 rounded-full px-4 py-2 shadow-xl ring-1 ring-white/10">
            <div className="flex items-center gap-2">
              <button
                onClick={onPrevPage}
                disabled={pageNum <= 1}
                className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
                aria-label={tCommon('aria.previousPage')}
              >
                <ChevronUp className="size-5" />
              </button>
              <button
                onClick={onNextPage}
                disabled={pageNum >= totalPages}
                className="grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-35"
                aria-label={tCommon('aria.nextPage')}
              >
                <ChevronDown className="size-5" />
              </button>
            </div>
            <input
              type="number"
              min={1}
              max={Math.max(1, totalPages)}
              value={pageNum}
              onChange={onPageInputChange}
              className="bg-background w-10 appearance-none rounded-md py-1 text-center text-sm ring-1 ring-white/20 focus:ring-white/40 focus:outline-none"
            />
            <div>/</div>
            <div className="w-4 text-center text-sm tabular-nums">
              {totalPages || 0}
            </div>
            <div className="flex items-center gap-2">
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
            </div>
          </div>
        </div>
        {!pdfDoc && (
          <div className="mt-4 text-center text-gray-500">
            {t('preview.loading')}
          </div>
        )}
      </div>
    </>
  );
};
