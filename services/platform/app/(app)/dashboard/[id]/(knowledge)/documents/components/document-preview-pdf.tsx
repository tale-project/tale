'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut } from 'lucide-react';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
  PageViewport,
} from 'pdfjs-dist/types/src/pdf';
import { useT } from '@/lib/i18n';

type PdfJsLib = {
  getDocument: typeof import('pdfjs-dist/types/src/pdf').getDocument;
  GlobalWorkerOptions: typeof import('pdfjs-dist/types/src/pdf').GlobalWorkerOptions;
};

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
        script.onload = () => {
          const lib = (window as unknown as { pdfjsLib: PdfJsLib }).pdfjsLib;
          lib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setPdfjsLib(lib);
        };
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
      const bufferCanvas = bufferCanvasRef.current as HTMLCanvasElement | null;
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
      const canvas = canvasRef.current as HTMLCanvasElement;
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
  const queueRenderPage = (num: number) => {
    if (pageRendering) {
      setPageNumPending(num);
    } else {
      renderPage(num);
    }
  };

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
  }, [scale, pageNum, pdfDoc]);

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
      <div className="p-6 mx-auto relative overflow-y-auto w-full flex-1 overflow-x-visible">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="block absolute top-0 left-1/2 -translate-x-1/2"
          style={{ maxWidth: `calc(48rem * ${scale})`, height: 'auto' }}
        />
        {/* Sticky center-bottom toolbar */}
        <div className="sticky top-[95%] flex w-full justify-center z-50">
          <div className="flex items-center gap-4 rounded-full bg-background text-foreground px-4 py-2 shadow-xl ring-1 ring-white/10">
            <div className="flex items-center gap-2">
              <button
                onClick={onPrevPage}
                disabled={pageNum <= 1}
                className="grid place-items-center size-8 rounded-full hover:bg-white/10 transition disabled:opacity-35"
                aria-label={tCommon('aria.previousPage')}
              >
                <ChevronUp className="size-5" />
              </button>
              <button
                onClick={onNextPage}
                disabled={pageNum >= totalPages}
                className="grid place-items-center size-8 rounded-full hover:bg-white/10 transition disabled:opacity-35"
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
              className="w-10 appearance-none rounded-md bg-background text-sm text-center py-1 ring-1 ring-white/20 focus:outline-none focus:ring-white/40"
            />
            <div>/</div>
            <div className="w-4 text-center text-sm tabular-nums">
              {totalPages || 0}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onZoomOut}
                className="grid place-items-center size-8 rounded-full hover:bg-white/10 transition"
                aria-label={tCommon('aria.zoomOut')}
              >
                <ZoomOut className="size-4" />
              </button>
              <button
                onClick={onZoomIn}
                className="grid place-items-center size-8 rounded-full hover:bg-white/10 transition"
                aria-label={tCommon('aria.zoomIn')}
              >
                <ZoomIn className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {!pdfDoc && (
          <div className="mt-4 text-gray-500 text-center">
            {t('preview.loading')}
          </div>
        )}
      </div>
    </>
  );
};

